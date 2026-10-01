/**
 * InteractionTrack — interactions datées évaluables à toute frame.
 *
 * Spec : 05-compilation-3d §7, 06-correctifs C8.
 *
 * Concepts clés :
 *   - Un événement d'interaction (pickup, carry, put-down) est représenté par
 *     une fenêtre [startFrame, endFrameExclusive) avec contactFrame et releaseFrame.
 *   - L'état d'un prop est évalué à une frame donnée par evalAt(frame) :
 *     AVANT contact → prop sur support ; À contact → attaché à la main ;
 *     APRÈS release → transform figé en world à la frame de release.
 *   - L'évaluation est déterministe et idempotente : scrub, export et retour
 *     arrière donnent le même résultat.
 *   - Un collider dynamique est conservé pendant le port ; seules les paires
 *     main/prop explicitement attendues sont filtrées dans la détection.
 *   - L'absence d'un solver IK capable bloque le label « contact vérifié ».
 *
 * Ce module est pur : aucun appel réseau, aucune mutation de scène Three.js.
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** États d'un prop à une frame donnée. */
export const PROP_STATE = Object.freeze({
	ON_SUPPORT: "on-support",   // Avant startFrame ou après endFrameExclusive
	APPROACHING: "approaching", // [startFrame, contactFrame)  — main s'approche
	HELD: "held",               // [contactFrame, releaseFrame ?? endFrameExclusive)
	RELEASED: "released",       // [releaseFrame, endFrameExclusive)  — world figé
});

/** Décalage d'interpolation contact (IK). Configurable. */
export const DEFAULT_APPROACH_FRAMES = 12;

// ---------------------------------------------------------------------------
// createInteractionEvent
// ---------------------------------------------------------------------------

/**
 * Valide et crée un événement d'interaction.
 *
 * @param {object} def
 * @param {string} def.objectId
 * @param {string} def.characterId
 * @param {'pick-up'|'carry'|'put-down'} def.kind
 * @param {'right'|'left'} def.hand
 * @param {number} def.startFrame
 * @param {number} def.contactFrame
 * @param {number} def.endFrameExclusive
 * @param {number|null} [def.releaseFrame]
 * @param {string} [def.gripAnchor]
 * @param {string} [def.initialParent]
 * @returns {object} Événement normalisé
 */
export function createInteractionEvent(def) {
	const {
		objectId,
		characterId,
		kind = "pick-up",
		hand = "right",
		startFrame,
		contactFrame,
		endFrameExclusive,
		releaseFrame = null,
		gripAnchor = "gripRight",
		initialParent = "world",
	} = def ?? {};

	if (!objectId) throw new TypeError("InteractionEvent: objectId is required.");
	if (!characterId) throw new TypeError("InteractionEvent: characterId is required.");
	if (typeof startFrame !== "number") throw new TypeError("InteractionEvent: startFrame must be a number.");
	if (typeof contactFrame !== "number") throw new TypeError("InteractionEvent: contactFrame must be a number.");
	if (typeof endFrameExclusive !== "number") throw new TypeError("InteractionEvent: endFrameExclusive must be a number.");
	if (startFrame > contactFrame) throw new RangeError("InteractionEvent: startFrame must be <= contactFrame.");
	if (contactFrame >= endFrameExclusive) throw new RangeError("InteractionEvent: contactFrame must be < endFrameExclusive.");
	if (releaseFrame !== null && (releaseFrame < contactFrame || releaseFrame >= endFrameExclusive)) {
		throw new RangeError("InteractionEvent: releaseFrame must be in [contactFrame, endFrameExclusive).");
	}

	return Object.freeze({
		objectId,
		characterId,
		kind,
		hand,
		startFrame,
		contactFrame,
		endFrameExclusive,
		releaseFrame,
		gripAnchor,
		initialParent,
	});
}

// ---------------------------------------------------------------------------
// evalPropState
// ---------------------------------------------------------------------------

/**
 * Évalue l'état d'un prop à une frame donnée, pour un événement donné.
 * Déterministe et sans effet de bord.
 *
 * @param {object} event  Événement créé par createInteractionEvent
 * @param {number} frame  Frame locale (dans la scène de l'événement)
 * @returns {{ state: string, alpha: number, ikRequired: boolean }}
 *   - state   : PROP_STATE
 *   - alpha   : [0,1] pour interpolation approche/release
 *   - ikRequired : si l'approche IK est nécessaire à cette frame
 */
export function evalPropState(event, frame) {
	const { startFrame, contactFrame, endFrameExclusive, releaseFrame } = event;

	// Hors fenêtre d'interaction
	if (frame < startFrame || frame >= endFrameExclusive) {
		return { state: PROP_STATE.ON_SUPPORT, alpha: 0, ikRequired: false };
	}

	// Phase de release : world transform figé
	if (releaseFrame !== null && frame >= releaseFrame) {
		const releaseDuration = endFrameExclusive - releaseFrame;
		const alpha = releaseDuration > 0 ? (frame - releaseFrame) / releaseDuration : 1;
		return { state: PROP_STATE.RELEASED, alpha, ikRequired: false };
	}

	// Phase de port (held)
	if (frame >= contactFrame) {
		return { state: PROP_STATE.HELD, alpha: 1, ikRequired: false };
	}

	// Phase d'approche [startFrame, contactFrame) — interpolation vers gripAnchor
	const approachDuration = Math.max(1, contactFrame - startFrame);
	const alpha = (frame - startFrame) / approachDuration;
	return { state: PROP_STATE.APPROACHING, alpha, ikRequired: true };
}

// ---------------------------------------------------------------------------
// computeWorldTransformAtContact
// ---------------------------------------------------------------------------

/**
 * Calcule le transform world du prop au moment du contact, assurant continuité.
 *
 * objectWorld = handWorld × gripOffset
 *
 * @param {object} handWorldAtContact  { position: [x,y,z], quaternion: [x,y,z,w] }
 * @param {object} gripOffset          { position: [x,y,z], quaternion: [x,y,z,w] }
 * @returns {object} { position: [x,y,z], quaternion: [x,y,z,w] }
 */
export function computeWorldTransformAtContact(handWorldAtContact, gripOffset) {
	if (!handWorldAtContact || !gripOffset) {
		throw new TypeError("computeWorldTransformAtContact: handWorldAtContact and gripOffset are required.");
	}
	// Composition de transforms : pos = handPos + rotateByQuat(handQuat, gripPos)
	// quaternion = multiply(handQuat, gripQuat)
	const hp = handWorldAtContact.position ?? [0, 0, 0];
	const hq = handWorldAtContact.quaternion ?? [0, 0, 0, 1];
	const gp = gripOffset.position ?? [0, 0, 0];
	const gq = gripOffset.quaternion ?? [0, 0, 0, 1];

	// Rotation du grip position par le quaternion de la main
	const rp = rotateVec3ByQuat(gp, hq);

	return {
		position: [hp[0] + rp[0], hp[1] + rp[1], hp[2] + rp[2]],
		quaternion: multiplyQuat(hq, gq),
	};
}

// ---------------------------------------------------------------------------
// InteractionTrack — ensemble d'événements pour une scène
// ---------------------------------------------------------------------------

/**
 * Crée une piste d'interactions pour une scène.
 * Permet d'évaluer l'ensemble des props à une frame donnée.
 *
 * @param {object[]} events  Tableau d'InteractionEvent
 * @returns {object}
 */
export function createInteractionTrack(events) {
	if (!Array.isArray(events)) {
		throw new TypeError("createInteractionTrack: events must be an array.");
	}

	// Vérifier unicité objectId par fenêtre temporelle (pas de chevauchement sur le même objet)
	const byObject = new Map();
	for (const ev of events) {
		const existing = byObject.get(ev.objectId) ?? [];
		for (const other of existing) {
			if (ev.startFrame < other.endFrameExclusive && ev.endFrameExclusive > other.startFrame) {
				throw new RangeError(
					`InteractionTrack: overlapping events for objectId "${ev.objectId}" at frames [${ev.startFrame}, ${ev.endFrameExclusive}).`
				);
			}
		}
		byObject.set(ev.objectId, [...existing, ev]);
	}

	/**
	 * Évalue tous les props actifs à une frame.
	 * @param {number} frame
	 * @returns {Map<string, {event, state, alpha, ikRequired}>}
	 */
	function evalAt(frame) {
		const result = new Map();
		for (const ev of events) {
			if (frame >= ev.startFrame && frame < ev.endFrameExclusive) {
				const evaluation = evalPropState(ev, frame);
				result.set(ev.objectId, { event: ev, ...evaluation });
			}
		}
		return result;
	}

	/**
	 * Indique si un pair (objectId, characterId) est un contact attendu à cette frame.
	 * Utilisé pour filtrer les collisions dans la détection de collision.
	 * @param {string} objectId
	 * @param {string} characterId
	 * @param {number} frame
	 * @returns {boolean}
	 */
	function isExpectedContact(objectId, characterId, frame) {
		const objectEvents = byObject.get(objectId) ?? [];
		return objectEvents.some(
			(ev) => ev.characterId === characterId && frame >= ev.contactFrame && (ev.releaseFrame === null || frame < ev.releaseFrame) && frame < ev.endFrameExclusive
		);
	}

	/**
	 * Vérifie si l'IK est requise à une frame donnée (approche d'un prop).
	 * @param {string} characterId
	 * @param {number} frame
	 * @returns {boolean}
	 */
	function requiresIK(characterId, frame) {
		return events.some((ev) => {
			if (ev.characterId !== characterId) return false;
			const { ikRequired } = evalPropState(ev, frame);
			return ikRequired;
		});
	}

	/**
	 * Retourne les événements qui chevauchent un intervalle.
	 * Utile pour déterminer si un contact/impact protège d'un blend.
	 * @param {number} startFrame
	 * @param {number} endFrameExclusive
	 * @returns {object[]}
	 */
	function eventsInRange(startFrame, endFrameExclusive) {
		return events.filter(
			(ev) => ev.startFrame < endFrameExclusive && ev.endFrameExclusive > startFrame
		);
	}

	/**
	 * Vérifie la cohérence IK : si un IK solver n'est pas déclaré capable,
	 * les contacts approche sont marqués unsupported.
	 * @param {boolean} ikCapable
	 * @returns {{ verifiedContacts: string[], unsupported: string[] }}
	 */
	function verifyIKCapability(ikCapable) {
		const verifiedContacts = [];
		const unsupported = [];
		for (const ev of events) {
			// S'il y a une phase d'approche IK
			if (ev.contactFrame > ev.startFrame) {
				if (ikCapable) {
					verifiedContacts.push(ev.objectId);
				} else {
					unsupported.push(`${ev.objectId}:${ev.kind}:approach-ik-unsupported`);
				}
			}
		}
		return { verifiedContacts, unsupported };
	}

	return Object.freeze({
		events: Object.freeze([...events]),
		evalAt,
		isExpectedContact,
		requiresIK,
		eventsInRange,
		verifyIKCapability,
	});
}

// ---------------------------------------------------------------------------
// Helpers maths purs (pas de dépendance Three.js pour les tests)
// ---------------------------------------------------------------------------

/** Multiplie deux quaternions q1 × q2. */
function multiplyQuat([ax, ay, az, aw], [bx, by, bz, bw]) {
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

/** Fait pivoter un vecteur 3D par un quaternion. */
function rotateVec3ByQuat([vx, vy, vz], [qx, qy, qz, qw]) {
	// t = 2 * cross(q.xyz, v)
	const tx = 2 * (qy * vz - qz * vy);
	const ty = 2 * (qz * vx - qx * vz);
	const tz = 2 * (qx * vy - qy * vx);
	return [
		vx + qw * tx + qy * tz - qz * ty,
		vy + qw * ty + qz * tx - qx * tz,
		vz + qw * tz + qx * ty - qy * tx,
	];
}
