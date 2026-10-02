"""Run with unittest. In staging, NARRATIVE_DEPENDENCY_ROOT points to the backend.
Tests use only in-memory SQLite and temporary audio, without real provider calls.
"""
import os
import sys
import types
from pathlib import Path
STAGED_ROOT = Path(__file__).resolve().parents[1]
if os.environ.get("NARRATIVE_DEPENDENCY_ROOT"):
    original = Path(os.environ["NARRATIVE_DEPENDENCY_ROOT"])
    for name in ("app", "app.schemas", "app.services", "app.api"):
        package = types.ModuleType(name)
        relative = name.replace(".", "/")
        package.__path__ = [str(STAGED_ROOT / relative), str(original / relative)]
        sys.modules[name] = package
else:
    sys.path.insert(0, str(STAGED_ROOT))

import json
import tempfile
import unittest
import wave
from unittest.mock import AsyncMock, patch
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.db.models import Base, Channel, Video, TTSAudio
from app.db.models_reproduction import ReproductionPlan
import app.db.models_scenes
from app.db.models_studio import StudioPreparationJob, StudioPreparationStep, StudioPreparationCandidate, StudioStoryDraft
from app.services.studio_narrative_sources import collect_narrative_sources, normalize_segments
from app.services.studio_narrative_service import NarrativePreparationService, validate_outline, validate_scene_plan
from app.services.studio_story_validation import validate_studio_story
from app.services.studio_story_snapshots import build_manifest_from_snapshot, paginate_section_items
from app.schemas.studio_story import StudioSnapshot
from app.schemas.studio_narrative import StoryOutline, ScenePlan, NarrativeRequest
from app.services.studio_audio_duration import measure_mp3_duration


class Mp3DurationTests(unittest.TestCase):
    def write_mp3(self, frames):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "audio.mp3"
        path.write_bytes(b"".join(frames))
        return path

    def frame(self, bitrate_index=9, version=3):
        word = (0x7FF << 21) | (version << 19) | (1 << 17) | (1 << 16) | (bitrate_index << 12)
        rate = 44100 if version == 3 else 22050
        bitrate = (128 if bitrate_index == 9 else 160) if version == 3 else 80
        size = (144000 if version == 3 else 72000) * bitrate // rate
        return word.to_bytes(4, "big") + bytes(size - 4)

    def test_variable_bitrate_and_id3_do_not_change_sample_clock(self):
        frames = [self.frame(9), self.frame(10)] * 3
        path = self.write_mp3([b"ID3\x04\x00\x00\x00\x00\x00\x04test", *frames, b"TAG" + bytes(125)])
        self.assertAlmostEqual(measure_mp3_duration(path), 6 * 1152 / 44100)

    def test_mpeg2_uses_576_samples_per_frame(self):
        path = self.write_mp3([self.frame(version=2)] * 4)
        self.assertAlmostEqual(measure_mp3_duration(path), 4 * 576 / 22050)

    def test_xing_gapless_encoder_delay_and_padding(self):
        first = bytearray(self.frame())
        first[36:40] = b"Xing"
        first[40:44] = (1).to_bytes(4, "big")
        first[44:48] = (3).to_bytes(4, "big")
        first[48:57] = b"LAME3.100"
        first[69:72] = ((576 << 12) | 288).to_bytes(3, "big")
        path = self.write_mp3([first, *[self.frame()] * 3])
        self.assertAlmostEqual(measure_mp3_duration(path), (3 * 1152 - 576 - 288) / 44100)

    def test_truncated_mp3_is_rejected(self):
        path = self.write_mp3([self.frame(), self.frame()[:-1]])
        with self.assertRaises(ValueError):
            measure_mp3_duration(path)


def fixture():
    local = Path(__file__).with_name("narrative-v2.json")
    return json.loads(local.read_text(encoding="utf-8"))


class NarrativeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.db = async_sessionmaker(self.engine, expire_on_commit=False)()
        self.audio = Path(self.temp.name) / "narration.wav"
        with wave.open(str(self.audio), "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
            audio.writeframes(b"\0\0" * 32000)
        channel = Channel(channel_id="test", name="Test")
        self.db.add(channel); await self.db.flush()
        self.db.add(Video(video_id="narrative", channel_id=channel.id, title="Test story", url="https://example.invalid", duration_seconds=12))
        await self.db.flush()
        transcript = json.dumps([{"start": 0, "end": 2, "text": "Break the monitor."}, {"start": 2, "end": 4.025, "text": "Later, the broken monitor is in the garage."}])
        self.db.add(TTSAudio(id=1, video_id="narrative", audio_path=str(self.audio), voice_id="test", model_id="test", transcript=transcript, duration_seconds=26.425))
        self.db.add(TTSAudio(id=2, video_id="narrative", audio_path=str(self.audio), voice_id="other", model_id="test", transcript=transcript, duration_seconds=4))
        self.db.add(ReproductionPlan(video_id="narrative", tts_audio_id=1, plan_data={"tts_duration": 26.425, "shots": [{"tts_end": 26.425}]}))
        await self.db.commit()
        self.source = await collect_narrative_sources(self.db, "narrative")

    async def asyncTearDown(self):
        await self.db.close(); await self.engine.dispose(); self.temp.cleanup()

    def outputs(self):
        f = fixture()
        outline = {"synopsis": "One continuous story in two rooms.", "editorialChoices": ["Use the final narration and keep simple sets."],
                   "characters": f["characters"], "sets": f["sets"], "scenes": [
                     {"id": "S1", "setId": "ROOM", "characterIds": ["YOUNG", "MOTHER"], "segmentStart": 0, "segmentEnd": 1, "summary": "Break the monitor", "timeContext": "Present"},
                     {"id": "S2", "setId": "GARAGE", "characterIds": ["YOUNG"], "segmentStart": 1, "segmentEnd": 2, "summary": "Aftermath", "timeContext": "Later"}]}
        plans = [{"scene": s, "shots": [shot for shot in f["shots"] if shot["sceneId"] == s["id"]],
                  "actions": [a for a in f["actions"] if a["sceneId"] == s["id"]]} for s in f["scenes"]]
        return outline, plans

    async def job(self, parent=None, from_scene=None):
        job = StudioPreparationJob(id="story_" + str(parent or "root") + str(from_scene or ""), project_id="narrative",
            parent_job_id=parent, source_bundle=self.source, source_fingerprint=self.source["sourceFingerprint"],
            candidate_version=0, status="queued", stage="outline", scope={}, prompt_pack_version="narrative-v2",
            provider="", model="test", capabilities_hash="sha256:" + "0" * 64,
            config={"pipeline": "narrative-v2", "instructions": "", "fromSceneId": from_scene, "maxCalls": 20, "maxOutputTokens": 100000}, usage={"calls": 0, "estimatedTokens": 0})
        self.db.add(job); await self.db.commit(); return job

    async def test_actual_audio_wins_over_metadata_old_plan_and_newest_tts(self):
        self.assertEqual(self.source["durationSeconds"], 4)
        self.assertEqual(self.source["frameCount"], 96)
        self.assertEqual(self.source["selectedTtsId"], 1)
        self.assertEqual(self.source["segments"][-1]["endSeconds"], 4)
        explicit = await collect_narrative_sources(self.db, "narrative", 2)
        self.assertEqual(explicit["selectedTtsId"], 2)
        self.assertNotEqual(explicit["sourceFingerprint"], self.source["sourceFingerprint"])

    async def test_fresh_project_needs_no_bible_or_reproduction(self):
        from sqlalchemy import delete
        await self.db.execute(delete(ReproductionPlan)); await self.db.commit()
        source = await collect_narrative_sources(self.db, "narrative", 1)
        self.assertEqual(source["visualReferences"]["bible"], {})
        self.assertEqual(source["visualReferences"]["reproduction"], {})
        self.assertTrue(source["narrationText"])

    async def test_pipeline_repairs_and_checkpoints_without_manual_decisions(self):
        outline, plans = self.outputs()
        bad = json.loads(json.dumps(plans[0])); bad["shots"][1]["endSeconds"] = 1.5
        mocked = AsyncMock(side_effect=[(json.dumps(o), {"estimatedTokens": 100}) for o in [outline, bad, plans[0], plans[1]]])
        job = await self.job()
        with patch("app.services.studio_narrative_service.StudioLLMClient"):
            service = NarrativePreparationService(self.db, job); service.llm._invoke_llm = mocked
            await service.run()
        self.assertEqual(mocked.await_count, 4)
        candidate = (await self.db.execute(select(StudioPreparationCandidate))).scalars().one()
        self.assertEqual(candidate.review["decisions"], [])
        self.assertTrue(candidate.readiness["directivesReady"])
        self.assertFalse(candidate.readiness["executionReady"])
        self.assertTrue(validate_studio_story(candidate.draft)[0])
        self.assertEqual(candidate.draft["project"]["durationSeconds"], 4)
        self.assertEqual(job.status, "succeeded")
        self.assertEqual(job.usage["calls"], 4)
        manifest = build_manifest_from_snapshot(StudioSnapshot(**candidate.draft))
        self.assertEqual(manifest.schemaVersion, "cozy-story-v2")
        page = paginate_section_items(StudioSnapshot(**candidate.draft), "scenes", manifest.manifestHash)
        self.assertEqual(page.schemaVersion, "cozy-story-v2")
        self.assertTrue(page.items[0]["cameras"])
        self.assertEqual(len((await self.db.execute(select(StudioPreparationStep))).scalars().all()), 3)
        # A targeted reanalysis reuses outline/first scene and calls only scene 2.
        child = await self.job(job.id, "S2")
        with patch("app.services.studio_narrative_service.StudioLLMClient"):
            service = NarrativePreparationService(self.db, child)
            service.llm._invoke_llm = AsyncMock(return_value=(json.dumps(plans[1]), {"estimatedTokens": 100}))
            await service.run()
            self.assertEqual(service.llm._invoke_llm.await_count, 1)

    async def test_facial_directives_need_no_animation_keys_and_survive_publication(self):
        outline, plans = self.outputs()
        facial = {"id": "FACE_01", "kind": "expression", "sceneId": "S2", "characterId": "YOUNG",
                  "startSeconds": 0, "endSeconds": 2,
                  "description": "Raise the eyebrows, tighten the lips, then lower the gaze.",
                  "intent": "shock", "keys": [], "binding": None}
        plans[1]["actions"].append(facial)
        job = await self.job()
        with patch("app.services.studio_narrative_service.StudioLLMClient"):
            service = NarrativePreparationService(self.db, job)
            service.llm._invoke_llm = AsyncMock(side_effect=[
                (json.dumps(output), {"estimatedTokens": 100}) for output in [outline, *plans]])
            await service.run()
            self.assertEqual(service.llm._invoke_llm.await_count, 3)
        candidate = (await self.db.execute(select(StudioPreparationCandidate))).scalars().one()
        expression = next(action for action in candidate.draft["actions"] if action["id"] == "FACE_01")
        self.assertEqual(expression["description"], facial["description"])
        self.assertEqual(expression["kind"], "expression")
        self.assertEqual(expression["keys"], [])
        self.assertEqual(candidate.review["decisions"], [])
        self.assertTrue(validate_studio_story(candidate.draft)[0])
        from app.services.studio_story_snapshots import publish_snapshot
        from app.services.studio_narrative_service import assemble_story
        snapshot = assemble_story(self.source, StoryOutline(**outline), [ScenePlan(**p) for p in plans])
        self.db.add(StudioStoryDraft(video_id="narrative", draft_version="facial", draft_data=snapshot.model_dump(exclude_none=True)))
        await self.db.commit()
        with patch.dict(os.environ, {"STUDIO_ASSETS_DIR": str(Path(self.temp.name) / "assets")}):
            published = await publish_snapshot(self.db, "narrative", "facial-publication", {"mode": "structured", "draftVersion": "facial"})
        from app.db.models_studio import StudioStorySnapshot
        stored = (await self.db.execute(select(StudioStorySnapshot))).scalars().one()
        self.assertEqual(stored.payload["actions"][-1]["description"], facial["description"])

    async def test_unexplained_state_change_and_invalid_interaction_are_rejected(self):
        raw, plans = self.outputs(); outline = StoryOutline(**raw)
        validate_outline(outline, self.source)
        first = ScenePlan(**plans[0]); validate_scene_plan(first, outline.scenes[0], self.source, outline, [])
        plans[1]["scene"]["entryState"][1]["condition"] = "intact"
        with self.assertRaises(ValueError):
            validate_scene_plan(ScenePlan(**plans[1]), outline.scenes[1], self.source, outline, [first])
        for missing in (None, "[]", "not json"):
            with self.assertRaises(ValueError): normalize_segments(missing, 4)

    async def test_cancelled_job_never_calls_provider(self):
        job = await self.job(); job.cancel_requested = True; await self.db.commit()
        with patch("app.services.studio_narrative_service.StudioLLMClient"):
            service = NarrativePreparationService(self.db, job)
            with self.assertRaises(InterruptedError): await service.run()
            service.llm._invoke_llm.assert_not_called()

    async def test_candidate_cannot_be_read_or_applied_to_another_project(self):
        from app.api.studio_routes import get_preparation_result, apply_candidate_to_draft
        from app.schemas.studio_preparation import PreparationApplyRequest
        from fastapi import HTTPException
        job = await self.job()
        self.db.add(StudioPreparationCandidate(id="candidate", job_id=job.id, version=1,
            draft=fixture(), review={}, provenance={}, readiness={"directivesReady": True},
            source_fingerprint=self.source["sourceFingerprint"]))
        await self.db.commit()
        with self.assertRaises(HTTPException) as error:
            await get_preparation_result("another-project", job.id, db=self.db, _token="test")
        self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException) as error:
            await apply_candidate_to_draft("another-project", job.id, PreparationApplyRequest(expectedCandidateVersion=1), db=self.db, _token="test")
        self.assertEqual(error.exception.status_code, 404)

    async def test_launch_is_idempotent_and_refuses_stale_sources(self):
        from app.api.studio_narrative_routes import create_narrative_analysis
        from fastapi import BackgroundTasks, HTTPException
        payload = NarrativeRequest(selectedTtsId=1, model="test", expectedSourceFingerprint=self.source["sourceFingerprint"])
        tasks = BackgroundTasks()
        created = await create_narrative_analysis("narrative", payload, tasks, "launch-key", self.db, "test")
        self.assertEqual(len(tasks.tasks), 1)
        replay = await create_narrative_analysis("narrative", payload, BackgroundTasks(), "launch-key", self.db, "test")
        self.assertEqual(replay["preparationId"], created["preparationId"])
        self.assertTrue(replay["replayed"])
        payload.expectedSourceFingerprint = "sha256:" + "0" * 64
        with self.assertRaises(HTTPException) as exc:
            await create_narrative_analysis("narrative", payload, BackgroundTasks(), "another-key", self.db, "test")
        self.assertEqual(exc.exception.status_code, 409)

    async def test_apply_publish_preserves_v2_and_audio_and_refuses_reapply(self):
        from app.services.studio_narrative_service import assemble_story
        from app.api.studio_routes import apply_candidate_to_draft
        from app.schemas.studio_preparation import PreparationApplyRequest
        from app.services.studio_story_snapshots import publish_snapshot
        from app.services.studio_story_resources import resolve_resource_file
        from app.db.models_studio import StudioStorySnapshot
        from fastapi import HTTPException
        raw, plans = self.outputs()
        snapshot = assemble_story(self.source, StoryOutline(**raw), [ScenePlan(**p) for p in plans])
        job = await self.job()
        candidate = StudioPreparationCandidate(id="candidate", job_id=job.id, version=1, draft=snapshot.model_dump(exclude_none=True),
            review={}, provenance={}, readiness={"directivesReady": True}, source_fingerprint=self.source["sourceFingerprint"])
        self.db.add(candidate); await self.db.commit()
        request = PreparationApplyRequest(expectedCandidateVersion=1, expectedSourceFingerprint=self.source["sourceFingerprint"])
        applied = await apply_candidate_to_draft("narrative", job.id, request, db=self.db, _token="test")
        self.assertEqual(applied["status"], "applied")
        request.expectedDraftVersion = applied["draftVersion"]
        with self.assertRaises(HTTPException) as conflict:
            await apply_candidate_to_draft("narrative", job.id, request, db=self.db, _token="test")
        self.assertEqual(conflict.exception.status_code, 409)
        with patch.dict(os.environ, {"STUDIO_ASSETS_DIR": str(Path(self.temp.name) / "assets")}):
            published = await publish_snapshot(self.db, "narrative", "publication-key", {"mode": "structured", "draftVersion": applied["draftVersion"]})
            stored = (await self.db.execute(select(StudioStorySnapshot))).scalars().one()
            self.assertEqual(stored.payload["schemaVersion"], "cozy-story-v2")
            self.assertEqual(build_manifest_from_snapshot(StudioSnapshot(**stored.payload)).schemaVersion, "cozy-story-v2")
            resource = snapshot.resources[0]
            self.assertEqual(resolve_resource_file("narrative", published["revision"], resource).read_bytes(), self.audio.read_bytes())


if __name__ == "__main__":
    unittest.main()
