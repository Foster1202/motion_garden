/** Degrees are rest-relative; lateralOffset uses glTF model units (+X screen right). */
export interface RabbitPose {
  leftArmElevation: number;
  rightArmElevation: number;
  leftArmPlane: number;
  rightArmPlane: number;
  leftElbowBend: number;
  rightElbowBend: number;
  torsoLean: number;
  torsoForward: number;
  headYaw: number;
  headPitch: number;
  bendAmount: number;
  lateralOffset: number;
  trackingConfidence: number;
  timestampMs: number;
}

export function neutralRabbitPose(timestampMs = 0): RabbitPose {
  return {
    leftArmElevation: 0, rightArmElevation: 0, leftElbowBend: 0, rightElbowBend: 0,
    leftArmPlane: 0, rightArmPlane: 0, torsoForward: 0, headYaw: 0, headPitch: 0,
    torsoLean: 0, bendAmount: 0, lateralOffset: 0, trackingConfidence: 0,
    timestampMs: Number.isFinite(timestampMs) ? Math.max(0, timestampMs) : 0,
  };
}
