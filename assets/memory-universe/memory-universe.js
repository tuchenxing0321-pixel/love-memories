import * as THREE from "../vendor/three.module.min.js";

const DATA_URL = new URL("./sample-memories.json", import.meta.url);
const ROOT = document.querySelector("#memory-universe");

export class MemoryUniverse {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector(".memory-universe__canvas");
    this.loading = root.querySelector(".memory-universe__loading");
    this.detail = root.querySelector(".memory-detail");
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2(9, 9);
    this.raycaster = new THREE.Raycaster();
    this.frustum = new THREE.Frustum();
    this.projectionMatrix = new THREE.Matrix4();
    this.cameraGoal = new THREE.Vector3(0, 0, 32);
    this.lookGoal = new THREE.Vector3(0, 0, -7);
    this.lookCurrent = this.lookGoal.clone();
    this.panVelocity = new THREE.Vector2();
    this.zoomVelocity = 0;
    this.photoMeshes = [];
    this.textures = new Map();
    this.pointerState = new Map();
    this.isDragging = false;
    this.dragDistance = 0;
    this.selectedIndex = -1;
    this.savedView = null;
    this.historyOpened = false;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.layoutSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.disposed = false;
    this.fullView = { position: new THREE.Vector3(0, 0, 35), look: new THREE.Vector3(0, 0, -7) };
  }

  async init() {
    if (!this.canUseWebGL()) {
      await this.showFallback();
      return;
    }

    try {
      this.memories = await this.loadMemories();
      this.root.dataset.memoryCount = String(this.memories.length);
      if (!this.memories.length) {
        this.showEmptyState();
        return;
      }
      this.setupScene();
      this.createStars();
      this.createPhotoCloud();
      this.bindEvents();
      this.resize();
      this.animate();
      this.root.dataset.memoryUniverseState = "ready";
      requestAnimationFrame(() => this.loading.classList.add("is-finished"));
    } catch (error) {
      console.error("Memory universe could not start", error);
      this.showLoadError();
    }
  }

  async loadMemories() {
    if (typeof window.MemoryUniversePhotoSource === "function") {
      let timeout;
      try {
        const memories = await Promise.race([
          window.MemoryUniversePhotoSource(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Photo loading timed out")), 10000);
          }),
        ]);
        return Array.isArray(memories) ? memories : [];
      } finally {
        clearTimeout(timeout);
      }
    }
    return [];
  }

  showEmptyState() {
    this.loading.classList.add("is-finished");
    this.root.classList.add("is-empty");
    this.root.dataset.memoryUniverseState = "empty";
    const empty = this.root.querySelector(".memory-universe__empty");
    if (empty) empty.hidden = false;
  }

  showLoadError() {
    this.loading.classList.add("is-finished");
    this.root.dataset.memoryUniverseState = "error";
    const error = this.root.querySelector(".memory-universe__error");
    if (error) error.hidden = false;
  }

  canUseWebGL() {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
    } catch {
      return false;
    }
  }

  setupScene() {
    const narrowScreen = this.root.clientWidth / Math.max(this.root.clientHeight, 1) < 0.72;
    const openingZ = narrowScreen ? 54 : 35;
    this.cameraGoal.set(0, 0, openingZ);
    this.fullView.position.set(0, 0, narrowScreen ? 108 : 58);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07101d);
    this.scene.fog = new THREE.FogExp2(0x07101d, 0.014);
    this.camera = new THREE.PerspectiveCamera(46, this.root.clientWidth / Math.max(this.root.clientHeight, 1), 0.1, 220);
    this.camera.position.copy(this.cameraGoal);
    this.camera.lookAt(this.lookCurrent);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, innerWidth < 760 ? 1.45 : 1.8));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.photoGroup = new THREE.Group();
    this.pointGroup = new THREE.Group();
    this.scene.add(this.photoGroup, this.pointGroup);
    this.textureLoader = new THREE.TextureLoader();
  }

  // Deterministic 3D blue-noise sampling: spatial hashing enforces minimum
  // separation while low-frequency warping prevents a grid, sphere, or tunnel.
  createLayout(count) {
    const random = this.seededRandom(this.layoutSeed);
    const points = [];
    const hash = new Map();
    const volumeScale = Math.max(1, Math.cbrt(count / 40));
    const projectionScale = Math.min(1, Math.sqrt(50 / count));
    const cell = 4.8;
    const minimum = 4.35;
    const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    // A second collision pass protects the opening panorama: points that are
    // far apart in 3D can still cover each other after perspective projection.
    const overlapsOpeningView = (candidate) => {
      const depth = 35 - candidate.z;
      const screenX = candidate.x / depth;
      const screenY = candidate.y / depth;
      return points.some((point) => {
        const otherDepth = 35 - point.z;
        const horizontalGap = (2.45 / depth + 2.45 / otherDepth) * projectionScale;
        const verticalGap = (1.42 / depth + 1.42 / otherDepth) * projectionScale;
        return Math.abs(screenX - point.x / otherDepth) < horizontalGap
          && Math.abs(screenY - point.y / otherDepth) < verticalGap;
      });
    };
    const nearby = (candidate) => {
      const cx = Math.floor(candidate.x / cell);
      const cy = Math.floor(candidate.y / cell);
      const cz = Math.floor(candidate.z / cell);
      for (let x = cx - 1; x <= cx + 1; x += 1) {
        for (let y = cy - 1; y <= cy + 1; y += 1) {
          for (let z = cz - 1; z <= cz + 1; z += 1) {
            for (const index of hash.get(`${x},${y},${z}`) || []) {
              if (points[index].distanceTo(candidate) < minimum) return true;
            }
          }
        }
      }
      return false;
    };

    let attempts = 0;
    while (points.length < count && attempts < count * 1200) {
      attempts += 1;
      const z = -31 * volumeScale + random() * 47 * volumeScale;
      const phase = z * 0.12;
      const x = (random() * 2 - 1) * 19 * volumeScale + Math.sin(phase) * 1.7 + Math.sin(z * 0.037) * 2.2;
      const y = (random() * 2 - 1) * 10.5 * volumeScale + Math.cos(phase * 0.74) * 1.25 + Math.sin(x * 0.11) * 0.9;
      const candidate = new THREE.Vector3(x, y, z);
      // Mild continuous density variation, never discrete clusters.
      const density = 0.68 + 0.25 * (0.5 + 0.5 * Math.sin(x * 0.19 + z * 0.11));
      if (random() > density || nearby(candidate) || overlapsOpeningView(candidate)) continue;
      const index = points.push(candidate) - 1;
      const bucket = key(x, y, z);
      if (!hash.has(bucket)) hash.set(bucket, []);
      hash.get(bucket).push(index);
    }
    if (points.length !== count) throw new Error(`Could only place ${points.length}/${count} photos`);
    return points;
  }

  createPhotoCloud() {
    const positions = this.createLayout(this.memories.length);
    this.updateFullView(positions);
    const random = this.seededRandom(3210321);
    const glowTexture = this.createGlowTexture();

    this.memories.forEach((memory, index) => {
      const point = positions[index];
      const aspect = 16 / 9;
      const height = 2.15 + random() * 0.45;
      const width = height * aspect;
      const geometry = new THREE.PlaneGeometry(width, height);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.61 + random() * 0.025, 0.38, 0.26),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(point);
      mesh.rotation.set((random() - 0.5) * 0.13, (random() - 0.5) * 0.24, (random() - 0.5) * 0.12);
      mesh.userData = { memory, index, baseScale: 0.96 + random() * 0.09, textureRequested: false, visibleMix: 0, originalPosition: point.clone() };
      mesh.scale.setScalar(mesh.userData.baseScale);
      this.photoGroup.add(mesh);
      this.photoMeshes.push(mesh);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x99abd8, transparent: true, opacity: 0.22, depthWrite: false }));
      sprite.position.copy(point);
      sprite.scale.setScalar(0.42 + random() * 0.3);
      sprite.userData.photoIndex = index;
      this.pointGroup.add(sprite);
    });
  }

  updateFullView(positions) {
    const bounds = new THREE.Box3().setFromPoints(positions);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const distanceX = (size.x + 8) / (2 * Math.tan(horizontalFov / 2));
    const distanceY = (size.y + 7) / (2 * Math.tan(verticalFov / 2));
    const distance = Math.max(distanceX, distanceY) * 1.12 + size.z * 0.52;
    this.scene.fog.density = Math.min(0.014, 0.45 / Math.max(distance, 1));
    this.fullView.position.set(center.x, center.y, bounds.max.z + distance);
    this.fullView.look.copy(center);
    this.cameraGoal.copy(this.fullView.position);
    this.camera.position.copy(this.fullView.position);
    this.lookGoal.copy(this.fullView.look);
    this.lookCurrent.copy(this.fullView.look);
    this.maxCameraZ = Math.max(116, this.fullView.position.z + 12);
    this.camera.far = Math.max(220, this.maxCameraZ + size.z + 80);
    this.camera.updateProjectionMatrix();
  }

  createStars() {
    const random = this.seededRandom(91842);
    const count = innerWidth < 720 ? 240 : 470;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (random() * 2 - 1) * 54;
      positions[i * 3 + 1] = (random() * 2 - 1) * 30;
      positions[i * 3 + 2] = -45 + random() * 90;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x8b9abc, size: 0.045, transparent: true, opacity: 0.33, sizeAttenuation: true, depthWrite: false });
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }

  createGlowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(220,230,255,.95)");
    gradient.addColorStop(0.22, "rgba(153,174,222,.45)");
    gradient.addColorStop(1, "rgba(64,82,130,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.glowTexture = texture;
    return texture;
  }

  seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  loadTexture(mesh) {
    if (mesh.userData.textureRequested) return;
    mesh.userData.textureRequested = true;
    const url = new URL(mesh.userData.memory.thumbnail, DATA_URL).href;
    if (this.textures.has(url)) {
      this.applyTexture(mesh, this.textures.get(url));
      return;
    }
    this.textureLoader.load(url, (texture) => {
      if (this.disposed) return texture.dispose();
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      this.textures.set(url, texture);
      this.applyTexture(mesh, texture);
    }, undefined, () => {
      mesh.userData.textureRequested = false;
      mesh.material.color.set(0x6c7892);
    });
  }

  applyTexture(mesh, texture) {
    const image = texture.image;
    const width = image?.naturalWidth || image?.videoWidth || image?.width || 16;
    const height = image?.naturalHeight || image?.videoHeight || image?.height || 9;
    const aspect = width / Math.max(height, 1);
    const longSide = 4.2;
    const planeWidth = aspect >= 1 ? longSide : longSide * aspect;
    const planeHeight = aspect >= 1 ? longSide / aspect : longSide;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    mesh.material.map = texture;
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
  }

  bindEvents() {
    this.onResize = () => this.resize();
    this.onPointerDown = (event) => this.pointerDown(event);
    this.onPointerMove = (event) => this.pointerMove(event);
    this.onPointerUp = (event) => this.pointerUp(event);
    this.onWheel = (event) => this.wheel(event);
    this.onKeyDown = (event) => this.keyDown(event);
    this.onPopState = () => this.closeDetail(false);
    this.onPageHide = () => this.dispose();
    this.onDetailTouchStart = (event) => {
      const touch = event.changedTouches[0];
      this.detailTouchStart = { x: touch.clientX, y: touch.clientY };
    };
    this.onDetailTouchEnd = (event) => {
      if (!this.detailTouchStart) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - this.detailTouchStart.x;
      const dy = touch.clientY - this.detailTouchStart.y;
      this.detailTouchStart = null;
      if (Math.abs(dy) > 70 && dy > 0 && Math.abs(dy) > Math.abs(dx)) this.closeDetail();
      else if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy)) this.stepDetail(dx < 0 ? 1 : -1);
    };
    this.onDetailBackgroundClick = (event) => {
      if (event.target === this.detail) this.closeDetail();
    };
    window.addEventListener("resize", this.onResize, { passive: true });
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("popstate", this.onPopState);
    window.addEventListener("pagehide", this.onPageHide, { once: true });
    this.detail.addEventListener("touchstart", this.onDetailTouchStart, { passive: true });
    this.detail.addEventListener("touchend", this.onDetailTouchEnd, { passive: true });
    this.detail.addEventListener("click", this.onDetailBackgroundClick);

    this.root.querySelector(".memory-universe__reset").addEventListener("click", () => this.resetView());
    this.root.querySelector(".memory-detail__close").addEventListener("click", () => this.closeDetail());
    this.root.querySelector(".memory-detail__previous").addEventListener("click", () => this.stepDetail(-1));
    this.root.querySelector(".memory-detail__next").addEventListener("click", () => this.stepDetail(1));
  }

  pointerDown(event) {
    this.canvas.setPointerCapture(event.pointerId);
    this.pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY });
    this.isDragging = true;
    this.dragDistance = 0;
    this.lastPinch = this.pointerState.size === 2 ? this.pinchDistance() : 0;
  }

  pointerMove(event) {
    this.updatePointer(event);
    const state = this.pointerState.get(event.pointerId);
    if (!state) return;
    const dx = event.clientX - state.lastX;
    const dy = event.clientY - state.lastY;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    this.dragDistance += Math.abs(dx) + Math.abs(dy);
    if (this.pointerState.size === 2) {
      const distance = this.pinchDistance();
      this.zoomVelocity += (distance - this.lastPinch) * 0.015;
      this.lastPinch = distance;
      return;
    }
    if (this.pointerState.size === 1) {
      this.panVelocity.x += -dx * 0.0045;
      this.panVelocity.y += dy * 0.0045;
    }
  }

  pointerUp(event) {
    const wasTap = this.dragDistance < 9 && this.pointerState.size === 1;
    this.pointerState.delete(event.pointerId);
    this.isDragging = this.pointerState.size > 0;
    if (wasTap) this.selectAtPointer();
  }

  updatePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  pinchDistance() {
    const points = [...this.pointerState.values()];
    return points.length < 2 ? 0 : Math.hypot(points[0].lastX - points[1].lastX, points[0].lastY - points[1].lastY);
  }

  wheel(event) {
    event.preventDefault();
    this.updatePointer(event);
    this.zoomVelocity += THREE.MathUtils.clamp(-event.deltaY * 0.0015, -1.6, 1.6);
  }

  selectAtPointer() {
    if (this.selectedIndex >= 0) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.photoMeshes.filter((mesh) => mesh.visible), false);
    if (hits[0]) this.openDetail(hits[0].object.userData.index);
  }

  openDetail(index, pushHistory = true) {
    const mesh = this.photoMeshes[index];
    if (!mesh) return;
    if (this.selectedIndex < 0) {
      this.savedView = { position: this.cameraGoal.clone(), look: this.lookGoal.clone() };
    }
    this.selectedIndex = index;
    const direction = new THREE.Vector3().subVectors(this.camera.position, mesh.position).normalize();
    this.cameraGoal.copy(mesh.position).add(direction.multiplyScalar(5.1));
    this.lookGoal.copy(mesh.position);
    this.populateDetail(mesh.userData.memory);
    this.root.classList.add("is-detail-open");
    this.detail.classList.add("is-open");
    this.detail.setAttribute("aria-hidden", "false");
    if (pushHistory && !this.historyOpened) {
      history.pushState({ memoryDetail: true }, "", `${location.pathname}${location.search}#${mesh.userData.memory.id}`);
      this.historyOpened = true;
    }
  }

  populateDetail(memory) {
    const image = this.detail.querySelector(".memory-detail__image");
    image.src = new URL(memory.src, DATA_URL).href;
    image.alt = memory.title;
    this.detail.querySelector(".memory-detail__title").textContent = memory.title;
    this.detail.querySelector(".memory-detail__date").textContent = memory.date || "";
    this.detail.querySelector(".memory-detail__location").textContent = memory.location || "";
    this.detail.querySelector(".memory-detail__description").textContent = memory.description || "";
  }

  closeDetail(useHistory = true) {
    if (this.selectedIndex < 0) return;
    this.selectedIndex = -1;
    this.root.classList.remove("is-detail-open");
    this.detail.classList.remove("is-open");
    this.detail.setAttribute("aria-hidden", "true");
    if (this.savedView) {
      this.cameraGoal.copy(this.savedView.position);
      this.lookGoal.copy(this.savedView.look);
    }
    if (useHistory && this.historyOpened) history.back();
    this.historyOpened = false;
  }

  stepDetail(direction) {
    if (this.selectedIndex < 0) return;
    const next = (this.selectedIndex + direction + this.memories.length) % this.memories.length;
    this.openDetail(next, false);
  }

  keyDown(event) {
    if (event.key === "Escape") this.closeDetail();
    if (event.key === "ArrowLeft" && this.selectedIndex >= 0) this.stepDetail(-1);
    if (event.key === "ArrowRight" && this.selectedIndex >= 0) this.stepDetail(1);
  }

  resetView() {
    if (this.selectedIndex >= 0) this.closeDetail(false);
    this.cameraGoal.copy(this.fullView.position);
    this.lookGoal.copy(this.fullView.look);
    this.panVelocity.set(0, 0);
    this.zoomVelocity = 0;
  }

  updateCamera(delta) {
    if (this.selectedIndex < 0) {
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3(0, 1, 0);
      const pan = right.multiplyScalar(this.panVelocity.x).add(up.multiplyScalar(this.panVelocity.y));
      this.cameraGoal.add(pan);
      this.lookGoal.add(pan);
      this.cameraGoal.x = THREE.MathUtils.clamp(this.cameraGoal.x, -24, 24);
      this.cameraGoal.y = THREE.MathUtils.clamp(this.cameraGoal.y, -15, 15);
      this.lookGoal.x = THREE.MathUtils.clamp(this.lookGoal.x, -22, 22);
      this.lookGoal.y = THREE.MathUtils.clamp(this.lookGoal.y, -13, 13);

      if (Math.abs(this.zoomVelocity) > 0.0001) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const direction = this.raycaster.ray.direction.clone();
        const movement = direction.multiplyScalar(this.zoomVelocity);
        this.cameraGoal.add(movement);
        this.lookGoal.add(movement.multiplyScalar(0.72));
        this.cameraGoal.z = THREE.MathUtils.clamp(this.cameraGoal.z, -80, this.maxCameraZ || 116);
        this.lookGoal.z = THREE.MathUtils.clamp(this.lookGoal.z, -39, 20);
      }
    }
    const damping = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 5.6);
    this.camera.position.lerp(this.cameraGoal, damping);
    this.lookCurrent.lerp(this.lookGoal, damping);
    this.camera.lookAt(this.lookCurrent);
    this.panVelocity.multiplyScalar(this.reducedMotion ? 0 : 0.86);
    this.zoomVelocity *= this.reducedMotion ? 0 : 0.84;
  }

  updatePhotos(elapsed, delta) {
    this.camera.updateMatrixWorld();
    this.projectionMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionMatrix);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hovered = this.selectedIndex < 0 && !this.isDragging
      ? this.raycaster.intersectObjects(this.photoMeshes.filter((mesh) => mesh.visible), false)[0]?.object
      : null;

    this.photoMeshes.forEach((mesh, index) => {
      const distance = this.camera.position.distanceTo(mesh.position);
      const inView = this.frustum.intersectsObject(mesh);
      const detailMix = THREE.MathUtils.smoothstep(distance, 38, 10);
      const targetOpacity = inView ? THREE.MathUtils.clamp(detailMix * 1.1, 0.8, 1) : 0;
      mesh.userData.visibleMix = THREE.MathUtils.damp(mesh.userData.visibleMix, targetOpacity, 5, delta);
      const texturePresence = mesh.material.map ? 1 : 0.24;
      mesh.material.opacity = mesh.userData.visibleMix * texturePresence * (this.selectedIndex >= 0 ? 0.07 : 1);
      mesh.visible = mesh.material.opacity > 0.012;
      if (inView) this.loadTexture(mesh);
      const hoverScale = mesh === hovered ? 1.1 : 1;
      const selectedScale = index === this.selectedIndex ? 1.05 : 1;
      const scale = mesh.userData.baseScale * hoverScale * selectedScale;
      mesh.scale.lerp(new THREE.Vector3(scale, scale, scale), this.reducedMotion ? 1 : 0.12);
      if (!this.reducedMotion && this.selectedIndex < 0) {
        mesh.position.y = mesh.userData.originalPosition.y + Math.sin(elapsed * 0.16 + index * 1.7) * 0.06;
      }
      const sprite = this.pointGroup.children[index];
      sprite.material.opacity = THREE.MathUtils.clamp((1 - detailMix) * 0.36, 0.015, 0.3) * (this.selectedIndex >= 0 ? 0.08 : 1);
      sprite.visible = inView || distance > 30;
    });
    this.canvas.style.cursor = hovered ? "pointer" : this.isDragging ? "grabbing" : "grab";
  }

  animate = () => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this.updateCamera(delta);
    this.updatePhotos(elapsed, delta);
    if (!this.reducedMotion) this.stars.rotation.y = elapsed * 0.0025;
    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    if (!this.renderer) return;
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 760 ? 1.45 : 1.8));
    this.renderer.setSize(width, height, false);
  }

  async showFallback() {
    this.loading.classList.add("is-finished");
    const fallback = this.root.querySelector(".memory-universe__fallback");
    try {
      const memories = this.memories || await this.loadMemories();
      if (!memories.length) {
        this.showEmptyState();
        return;
      }
      fallback.hidden = false;
      const grid = fallback.querySelector(".memory-universe__fallback-grid");
      memories.forEach((memory) => {
        const figure = document.createElement("figure");
        const link = document.createElement("a");
        const image = document.createElement("img");
        const caption = document.createElement("figcaption");
        image.loading = "lazy";
        image.src = new URL(memory.thumbnail, DATA_URL).href;
        image.alt = memory.title;
        link.href = new URL(memory.src, DATA_URL).href;
        link.target = "_blank";
        link.rel = "noopener";
        link.setAttribute("aria-label", `放大查看：${memory.title}`);
        caption.textContent = memory.title;
        link.append(image);
        figure.append(link, caption);
        grid.append(figure);
      });
    } catch (error) {
      console.error("Fallback list failed", error);
      fallback.hidden = true;
      this.showLoadError();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("popstate", this.onPopState);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.detail.removeEventListener("touchstart", this.onDetailTouchStart);
    this.detail.removeEventListener("touchend", this.onDetailTouchEnd);
    this.detail.removeEventListener("click", this.onDetailBackgroundClick);
    this.photoMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    this.pointGroup.children.forEach((sprite) => sprite.material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.glowTexture?.dispose();
    this.stars?.geometry.dispose();
    this.stars?.material.dispose();
    this.renderer?.dispose();
  }
}

if (ROOT) new MemoryUniverse(ROOT).init();
