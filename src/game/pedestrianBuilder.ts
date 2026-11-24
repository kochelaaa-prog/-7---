import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';

export interface HumanVisualRig {
  root: THREE.Group;
  torsoGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  phoneMesh: THREE.Mesh;
  contactShadow: THREE.Mesh;
  /** Eye anchor in root local space for 1st-person on-foot mode */
  eyeOffsetY: number;
  dispose: () => void;
}

const SHIRT_PALETTE = [
  0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xe2e8f0, 0xf97316, 0x06b6d4,
];
const PANTS_PALETTE = [0x1e293b, 0x334155, 0x1f2937, 0x475569, 0x3f3f46];
const SKIN_PALETTE = [0xf1c27d, 0xe0ac69, 0xc68642, 0xffdbac, 0x8d5524];

export function buildHumanRig(
  textures: ProceduralTextureSet,
  seed: number,
  isPlayer = false,
  role: 'civilian' | 'police' = 'civilian'
): HumanVisualRig {
  const root = new THREE.Group();

  const isCop = role === 'police';
  const shirtColor = isPlayer ? 0xf59e0b : isCop ? 0x1e3a8a : SHIRT_PALETTE[seed % SHIRT_PALETTE.length];
  const pantsColor = isPlayer || isCop ? 0x0f172a : PANTS_PALETTE[(seed * 3) % PANTS_PALETTE.length];
  const skinColor = isPlayer ? 0xe0ac69 : SKIN_PALETTE[(seed * 7) % SKIN_PALETTE.length];

  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.62 });
  const hairMat = new THREE.MeshStandardMaterial({
    color: seed % 3 === 0 ? 0x27272a : seed % 3 === 1 ? 0x451a03 : 0x713f12,
    roughness: 0.8,
  });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });

  // Contact shadow disc
  const shGeo = new THREE.PlaneGeometry(0.95, 0.95);
  shGeo.rotateX(-Math.PI / 2);
  const shMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowMap,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const contactShadow = new THREE.Mesh(shGeo, shMat);
  contactShadow.position.y = 0.02;
  root.add(contactShadow);

  // Legs (pivoted at hip y = 0.84)
  const makeLeg = (xOff: number): THREE.Group => {
    const leg = new THREE.Group();
    leg.position.set(xOff, 0.84, 0);
    const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.76, 0.2), pantsMat);
    legMesh.position.y = -0.38;
    legMesh.castShadow = true;
    leg.add(legMesh);

    const shoeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.1, 0.28), shoeMat);
    shoeMesh.position.set(0, -0.79, -0.04);
    leg.add(shoeMesh);
    return leg;
  };
  const leftLeg = makeLeg(-0.12);
  const rightLeg = makeLeg(0.12);
  root.add(leftLeg);
  root.add(rightLeg);

  // Torso group (pivoted at waist y = 0.84)
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.84, 0);
  root.add(torsoGroup);

  const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirtMat);
  torsoMesh.position.y = 0.31;
  torsoMesh.castShadow = true;
  torsoGroup.add(torsoMesh);

  if (isCop) {
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.08, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.6 })
    );
    belt.position.y = 0.06;
    torsoGroup.add(belt);
    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.1, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.85, roughness: 0.2 })
    );
    badge.position.set(0.12, 0.44, -0.14);
    torsoGroup.add(badge);
  }

  // Head + Hair / Police Cap
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.66, 0);
  torsoGroup.add(headGroup);

  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
  headMesh.position.y = 0.14;
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  if (isCop) {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55 });
    const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.3), capMat);
    capTop.position.set(0, 0.28, 0);
    headGroup.add(capTop);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.14), capMat);
    visor.position.set(0, 0.24, -0.18);
    headGroup.add(visor);
    const capBadge = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.8, roughness: 0.2 })
    );
    capBadge.position.set(0, 0.29, -0.155);
    headGroup.add(capBadge);
  } else {
    const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), hairMat);
    hairMesh.position.set(0, 0.26, 0.01);
    headGroup.add(hairMesh);
  }

  // Arms (pivoted at shoulders)
  const makeArm = (xOff: number): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.set(xOff, 0.56, 0);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.28, 0.16), shirtMat);
    sleeve.position.y = -0.14;
    sleeve.castShadow = true;
    arm.add(sleeve);

    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.28, 0.14), skinMat);
    forearm.position.y = -0.4;
    arm.add(forearm);
    return arm;
  };
  const leftArm = makeArm(-0.32);
  const rightArm = makeArm(0.32);
  torsoGroup.add(leftArm);
  torsoGroup.add(rightArm);

  // Smartphone held in right hand (shown when calling police!)
  const phoneMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.16, 0.09),
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.4,
      roughness: 0.25,
    })
  );
  phoneMesh.position.set(-0.04, -0.54, -0.05);
  phoneMesh.visible = false;
  rightArm.add(phoneMesh);

  const dispose = () => {
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material?.dispose();
      }
    });
  };

  return {
    root,
    torsoGroup,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    phoneMesh,
    contactShadow,
    eyeOffsetY: 1.65,
    dispose,
  };
}
