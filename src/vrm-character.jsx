import { useEffect, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import { loadVrm, disposeVrm, setVrmStandingPose } from "./vrm-runtime.js";

export default function VrmCharacter({ url, position, rot, scale = 1, pose, onRig, pickId }) {
	const [state, setState] = useState({ url, rig: null, error: null });
	const reporter = useRef(onRig);
	reporter.current = onRig;
	useEffect(() => {
		let cancelled = false, owned = null;
		setState({ url, rig: null, error: null });
		loadVrm(url).then(rig => {
			if (cancelled) { disposeVrm(rig); return; }
			owned = rig;
			setVrmStandingPose(rig);
			setState({ url, rig, error: null });
		}).catch(error => {
			if (!cancelled) setState({ url, rig: null, error: error.message });
		});
		return () => { cancelled = true; reporter.current?.(null); disposeVrm(owned); };
	}, [url]);
	const rig = state.url === url ? state.rig : null;
	useEffect(() => {
		if (!rig) return;
		rig.scale.setScalar(scale);
		rig.updateMatrixWorld(true);
		reporter.current?.(rig);
	}, [rig, scale]);
	useEffect(() => {
		if (rig && pose) setVrmStandingPose(rig);
	}, [rig, pose]);
	return <group position={position} rotation={[0, rot * Math.PI / 180, 0]} userData={pickId ? { characterPick: pickId } : undefined}>
		{rig ? <primitive object={rig} dispose={null} /> : <Html center position={[0, 1.2, 0]}>
			<div className="vrm-load-status" role={state.error ? "alert" : "status"}>{state.error ? `VRM: ${state.error}` : "Loading avatar…"}</div>
		</Html>}
	</group>;
}
