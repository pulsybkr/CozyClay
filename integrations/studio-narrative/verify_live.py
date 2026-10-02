"""Read-only smoke check. Does not start an analysis, apply or publish anything."""
import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:8005")
parser.add_argument("--project", default="6PFqPX4d5hQ")
args = parser.parse_args()

def get(path):
    request = Request(args.base_url.rstrip("/") + path, headers={"X-UI-Client": "reproduction"})
    with urlopen(request, timeout=15) as response:
        assert response.status == 200
        return response.read()

page_path = "/video/" + args.project + "/studio3d"
assert "narrative-app" in get(page_path).decode()
assert get("/static/js/studio-narrative.js") == (Path(__file__).parent / "backend/app/static/js/studio-narrative.js").read_bytes()
source = json.loads(get("/api/studio/v2/projects/" + args.project + "/sources"))
assert source["canAnalyse"], source.get("message")
assert get("/video/" + args.project + "/reproduction").decode().count(page_path) >= 2
capabilities = json.loads(get("/api/studio/v1/capabilities"))
assert "cozy-story-v2" in capabilities["supportedSchemaVersions"]
print("PASS page, shipped controller, Reproduction links, source API and Studio v1/v2 capabilities")
print("TTS:", source["selectedTtsId"], "duration:", round(source["durationSeconds"], 3), "frames:", source["frameCount"])
