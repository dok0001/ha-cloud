import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

class HermesHACloudPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = null;
    this.nodes = [];
    this.mode = 'all';
    this.viewMode = 'constellation';
    this.labelMode = 'smart';
    this.motionMode = 'calm';
    this.selectedNode = null;
    this.hoveredNode = null;
    this.searchQuery = '';
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.nodeObjects = [];
    this.nodeMap = new Map();
    this.labelEls = new Map();
    this.clusterZones = [];
    this.clusterConfigs = this.createClusterConfigs();
    this.lastTime = performance.now();
    this.autoDrift = 0.00004;
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    const panel = hass?.panels?.['hermes-ha-cloud'];
    this.apiUrl = panel?.config?.api_url || '/api/hermes_ha_cloud/data';
    if (!this._loaded) {
      this._loaded = true;
      this.loadData();
    }
  }

  connectedCallback() {
    this.sceneHost = this.shadowRoot.getElementById('scene');
    this.detailsEl = this.shadowRoot.getElementById('details');
    this.statsEl = this.shadowRoot.getElementById('stats');
    this.filterEl = this.shadowRoot.getElementById('filters');
    this.tooltipEl = this.shadowRoot.getElementById('tooltip');
    this.labelsEl = this.shadowRoot.getElementById('labels');
    this.searchEl = this.shadowRoot.getElementById('search');
    this.focusListEl = this.shadowRoot.getElementById('focuslist');
    this.labelModeEl = this.shadowRoot.getElementById('labelmodes');
    this.motionModeEl = this.shadowRoot.getElementById('motionmodes');
    this.viewModeEl = this.shadowRoot.getElementById('viewmodes');
    this.miniMapEl = this.shadowRoot.getElementById('minimap');
    this.miniMapCtx = this.miniMapEl?.getContext('2d');
    this.initThree();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.sceneHost);
    this.resize();
    this.installEvents();
    this.raf = requestAnimationFrame((t) => this.animate(t));
  }

  disconnectedCallback() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  createClusterConfigs() {
    return {
      memory: {
        center: new THREE.Vector3(-78, -6, 14),
        spread: new THREE.Vector3(88, 54, 76),
        baseSize: 2.9,
        color: 0x7ee7ff,
        label: 'Addon nebula',
      },
      profile: {
        center: new THREE.Vector3(96, -34, -12),
        spread: new THREE.Vector3(88, 46, 62),
        baseSize: 2.8,
        color: 0xffb86d,
        label: 'Integration orbit',
      },
      skill: {
        center: new THREE.Vector3(16, 68, 24),
        spread: new THREE.Vector3(126, 72, 118),
        baseSize: 3.0,
        color: 0xae8cff,
        label: 'Device halo',
      },
      tool: {
        center: new THREE.Vector3(0, 2, -94),
        spread: new THREE.Vector3(76, 42, 56),
        baseSize: 2.55,
        color: 0x79f0ae,
        label: 'Entity lattice',
      },
    };
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          color: #eef3ff;
          --bg0: #02040b;
          --bg1: #08101f;
          --bg2: #101b37;
          --line: rgba(126, 180, 255, 0.16);
          --panel: rgba(10, 15, 31, 0.76);
          --border: rgba(130, 175, 255, 0.12);
          font-family: Inter, system-ui, sans-serif;
        }
        * { box-sizing: border-box; }
        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1.82fr) minmax(340px, 0.9fr);
          height: 100vh;
          background:
            radial-gradient(circle at 18% 14%, rgba(58, 126, 255, 0.16), transparent 26%),
            radial-gradient(circle at 74% 20%, rgba(150, 88, 255, 0.14), transparent 24%),
            radial-gradient(circle at 54% 84%, rgba(56, 220, 187, 0.11), transparent 24%),
            linear-gradient(180deg, var(--bg1), var(--bg0));
        }
        .scene-wrap {
          position: relative;
          min-height: 60vh;
          overflow: hidden;
          border-right: 1px solid var(--border);
        }
        #scene,
        .labels,
        .vignette,
        .grid-glow,
        .cinema-bar,
        .minimap-wrap {
          position: absolute;
        }
        #scene,
        .labels,
        .vignette,
        .grid-glow {
          inset: 0;
        }
        canvas#minimap {
          width: 180px;
          height: 180px;
          display: block;
          border-radius: 18px;
          background: radial-gradient(circle at 50% 50%, rgba(21, 31, 58, 0.85), rgba(6, 10, 23, 0.96));
          border: 1px solid rgba(146, 186, 255, 0.12);
          box-shadow: 0 16px 34px rgba(0, 0, 0, 0.28);
        }
        canvas.webgl {
          width: 100%;
          height: 100%;
          display: block;
        }
        .grid-glow {
          background:
            linear-gradient(transparent 0%, rgba(29, 71, 140, 0.09) 50%, transparent 100%),
            radial-gradient(circle at 50% 60%, rgba(111, 202, 255, 0.06), transparent 42%);
          mix-blend-mode: screen;
          pointer-events: none;
        }
        .vignette {
          background:
            radial-gradient(circle at center, transparent 46%, rgba(2, 4, 11, 0.26) 72%, rgba(2, 4, 11, 0.76) 100%);
          pointer-events: none;
          z-index: 3;
        }
        .cinema-bar {
          left: 0;
          right: 0;
          height: 28px;
          background: linear-gradient(180deg, rgba(0,0,0,0.72), rgba(0,0,0,0));
          pointer-events: none;
          z-index: 3;
        }
        .cinema-bar.bottom {
          top: auto;
          bottom: 0;
          transform: rotate(180deg);
        }
        .labels {
          pointer-events: none;
          z-index: 5;
        }
        .node-label {
          position: absolute;
          transform: translate(-50%, -50%);
          padding: 8px 11px;
          border-radius: 12px;
          border: 1px solid rgba(160, 197, 255, 0.16);
          background: rgba(7, 12, 26, 0.62);
          backdrop-filter: blur(8px);
          color: #eef4ff;
          min-width: 96px;
          max-width: 220px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.26);
          opacity: 0;
          transition: opacity 140ms ease, transform 140ms ease, border-color 140ms ease, background 140ms ease;
          pointer-events: auto;
          cursor: pointer;
        }
        .node-label:hover,
        .node-label.active {
          border-color: rgba(125, 215, 255, 0.34);
          background: rgba(12, 19, 39, 0.84);
          transform: translate(-50%, -50%) scale(1.04);
        }
        .node-label[data-type="memory"] { border-left: 3px solid #7ee7ff; }
        .node-label[data-type="skill"] { border-left: 3px solid #ae8cff; }
        .node-label[data-type="profile"] { border-left: 3px solid #ffb86d; }
        .node-label[data-type="tool"] { border-left: 3px solid #79f0ae; }
        .node-label .t {
          display: block;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .node-label .m {
          display: block;
          margin-top: 3px;
          color: #9fb3dd;
          font-size: 10px;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hud {
          position: absolute;
          inset: 0 auto auto 0;
          width: min(760px, calc(100% - 28px));
          margin: 16px;
          pointer-events: none;
          z-index: 4;
        }
        .headline {
          pointer-events: auto;
          background: linear-gradient(180deg, rgba(9,14,31,0.8), rgba(9,14,31,0.4));
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 14px 16px;
          backdrop-filter: blur(12px);
          box-shadow: 0 12px 42px rgba(0, 0, 0, 0.24);
        }
        .eyebrow {
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #90b9ff;
          margin-bottom: 6px;
        }
        h1 {
          margin: 0;
          font-size: 28px;
          line-height: 1.04;
        }
        .sub {
          margin-top: 8px;
          color: #b6c8ef;
          font-size: 13px;
          line-height: 1.45;
          max-width: 72ch;
        }
        .controls {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) auto auto auto;
          gap: 10px;
          margin-top: 14px;
          align-items: start;
        }
        .search {
          display: flex;
          align-items: center;
          padding: 0 12px;
          min-height: 40px;
          border-radius: 999px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(147, 185, 255, 0.12);
        }
        .search input {
          width: 100%;
          background: transparent;
          border: 0;
          outline: none;
          color: #eef3ff;
          font: inherit;
        }
        .search input::placeholder { color: #8ea1d1; }
        .control-group {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-end;
        }
        .filters,
        .control-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 14px;
        }
        button.pill,
        .filters button,
        .focus-row,
        .row {
          background: rgba(102, 153, 255, 0.08);
          color: #dce7ff;
          border: 1px solid rgba(135, 180, 255, 0.15);
          border-radius: 999px;
          padding: 7px 11px;
          cursor: pointer;
          font-weight: 600;
        }
        button.pill.active,
        .filters button.active {
          background: linear-gradient(180deg, rgba(63, 179, 255, 0.24), rgba(76, 97, 255, 0.16));
          box-shadow: 0 0 20px rgba(61,184,255,0.12);
        }
        .legend {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          color: #97a8d9;
          font-size: 12px;
        }
        .legend span::before {
          content: '';
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          margin-right: 8px;
          vertical-align: middle;
        }
        .memory::before { background: #7ee7ff; }
        .skill::before { background: #ae8cff; }
        .profile::before { background: #ffb86d; }
        .tool::before { background: #79f0ae; }
        .tooltip {
          position: absolute;
          transform: translate(-50%, calc(-100% - 14px));
          pointer-events: none;
          background: rgba(7, 12, 26, 0.88);
          border: 1px solid rgba(135, 180, 255, 0.18);
          border-radius: 12px;
          padding: 8px 10px;
          font-size: 12px;
          color: #ebf2ff;
          min-width: 120px;
          max-width: 280px;
          opacity: 0;
          transition: opacity 140ms ease;
          backdrop-filter: blur(8px);
          z-index: 6;
          box-shadow: 0 14px 30px rgba(0,0,0,0.26);
        }
        .tooltip.visible { opacity: 1; }
        .minimap-wrap {
          right: 20px;
          bottom: 22px;
          z-index: 5;
          pointer-events: none;
        }
        .minimap-copy {
          margin-top: 8px;
          color: #9ab1de;
          font-size: 11px;
          text-align: center;
          text-shadow: 0 1px 0 rgba(0,0,0,0.3);
        }
        aside {
          padding: 18px;
          overflow: auto;
          background: linear-gradient(180deg, rgba(6,10,24,0.97), rgba(10,14,31,0.94));
        }
        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 16px;
          margin-bottom: 14px;
          box-shadow: 0 12px 28px rgba(0,0,0,0.22);
          backdrop-filter: blur(10px);
        }
        .card h2, .card h3 { margin: 0 0 10px 0; }
        .stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .stat {
          padding: 12px;
          border-radius: 14px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .stat .v { font-size: 24px; font-weight: 800; }
        .stat .k { font-size: 12px; color: #93a4d6; text-transform: uppercase; letter-spacing: 0.08em; }
        .detail-type {
          display: inline-block;
          font-size: 12px;
          color: #8ab7ff;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          margin-bottom: 10px;
        }
        .detail-body {
          color: #d9e3ff;
          line-height: 1.55;
          font-size: 14px;
          white-space: pre-wrap;
        }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .chip {
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(126, 180, 255, 0.10);
          border: 1px solid rgba(126, 180, 255, 0.12);
          color: #d9e3ff;
          font-size: 12px;
        }
        .list,
        .focus-grid { display: grid; gap: 8px; }
        .row,
        .focus-row {
          width: 100%;
          text-align: left;
          border-radius: 12px;
          padding: 10px 12px;
        }
        .row:hover,
        .focus-row:hover {
          border-color: rgba(126, 180, 255, 0.24);
          background: rgba(126, 180, 255, 0.08);
        }
        .row strong,
        .focus-row strong { display: block; }
        .row small,
        .focus-row small { color: #95a8d7; }
        .microcopy {
          color: #96a8d7;
          font-size: 12px;
          line-height: 1.45;
          margin-top: 8px;
        }
        @media (max-width: 1320px) {
          .controls {
            grid-template-columns: 1fr;
          }
          .control-group { justify-content: flex-start; }
          .minimap-wrap { right: 14px; bottom: 14px; transform: scale(0.9); transform-origin: bottom right; }
        }
        @media (max-width: 980px) {
          .layout { grid-template-columns: 1fr; grid-template-rows: minmax(56vh, 60vh) auto; }
          .scene-wrap { border-right: 0; border-bottom: 1px solid var(--border); }
        }
      </style>
      <div class="layout">
        <div class="scene-wrap">
          <div id="scene"></div>
          <div class="grid-glow"></div>
          <div class="labels" id="labels"></div>
          <div class="tooltip" id="tooltip"></div>
          <div class="vignette"></div>
          <div class="cinema-bar top"></div>
          <div class="cinema-bar bottom"></div>
          <div class="hud">
            <div class="headline">
              <div class="eyebrow">Hermes / Neural Memory Topology</div>
              <h1>Mind Cloud</h1>
              <div class="sub">Cinematic memory observatory med constellation- och timeline-läge, glow-trails mellan noder, zonkartor och mini-map. Dra för att rotera, använd sök för att fokusera och klicka för att låsa en nod.</div>
              <div class="controls">
                <label class="search">
                  <input id="search" type="search" placeholder="Sök add-ons, integrationer, enheter, entiteter..." />
                </label>
                <div class="control-group control-pills" id="viewmodes"></div>
                <div class="control-group control-pills" id="labelmodes"></div>
                <div class="control-group control-pills" id="motionmodes"></div>
              </div>
              <div class="filters" id="filters"></div>
              <div class="legend">
                <span class="memory">Memory</span>
                <span class="skill">Enheter</span>
                <span class="profile">Integrationer</span>
                <span class="tool">Entiteter</span>
              </div>
            </div>
          </div>
          <div class="minimap-wrap">
            <canvas id="minimap" width="180" height="180"></canvas>
            <div class="minimap-copy">Cluster map / live focus radar</div>
          </div>
        </div>
        <aside>
          <div class="card">
            <h2>Live snapshot</h2>
            <div class="stats" id="stats"></div>
          </div>
          <div class="card" id="details"></div>
          <div class="card">
            <h3>Focus lane</h3>
            <div class="microcopy">Viktigaste synliga noderna just nu. Påverkas av filter, sök, label-läge och vald vy.</div>
            <div class="focus-grid" id="focuslist"></div>
          </div>
          <div class="card">
            <h3>Top enheter</h3>
            <div class="list" id="topskills"></div>
          </div>
        </aside>
      </div>
    `;
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040916);
    this.scene.fog = new THREE.FogExp2(0x060b18, 0.0021);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 2200);
    this.camera.position.set(0, 22, 330);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.classList.add('webgl');
    this.sceneHost.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = false;
    this.controls.minDistance = 180;
    this.controls.maxDistance = 580;
    this.controls.autoRotate = false;
    this.controls.target.set(0, 8, 0);

    this.scene.add(new THREE.AmbientLight(0x8fb5ff, 0.95));

    const keyLight = new THREE.PointLight(0x6ed5ff, 1.55, 1400, 2);
    keyLight.position.set(0, 44, 38);
    this.scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x6e7dff, 0.72, 1200, 2);
    fillLight.position.set(-200, 90, 230);
    this.scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x89ffc9, 0.48, 980, 2);
    rimLight.position.set(210, -42, -180);
    this.scene.add(rimLight);

    this.coreGlow = new THREE.Mesh(
      new THREE.SphereGeometry(18, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x85e8ff, transparent: true, opacity: 0.95 })
    );
    this.scene.add(this.coreGlow);

    this.coreShell = new THREE.Mesh(
      new THREE.SphereGeometry(36, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x4c69ff, transparent: true, opacity: 0.08 })
    );
    this.scene.add(this.coreShell);

    this.selectionAura = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xb9f4ff, transparent: true, opacity: 0.16 })
    );
    this.selectionAura.visible = false;
    this.scene.add(this.selectionAura);

    const starCount = 1100;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const radius = 340 + Math.random() * 560;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = Math.cos(theta) * Math.sin(phi) * radius;
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 340;
      starPositions[i * 3 + 2] = Math.cos(phi) * radius;
    }
    const starsGeo = new THREE.BufferGeometry();
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starsMat = new THREE.PointsMaterial({ color: 0x7fbfff, size: 1.6, transparent: true, opacity: 0.62 });
    this.starfield = new THREE.Points(starsGeo, starsMat);
    this.scene.add(this.starfield);

    this.rings = [];
    [
      { radius: 68, tube: 0.18, color: 0x5e79ff, tiltX: 1.05, tiltY: 0.35 },
      { radius: 96, tube: 0.16, color: 0x55d2ff, tiltX: 0.3, tiltY: 0.92 },
      { radius: 126, tube: 0.14, color: 0x83ffcb, tiltX: 1.34, tiltY: 0.12 },
    ].forEach((spec) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(spec.radius, spec.tube, 14, 140),
        new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.1 })
      );
      ring.rotation.x = spec.tiltX;
      ring.rotation.y = spec.tiltY;
      this.scene.add(ring);
      this.rings.push(ring);
    });

    this.graphRoot = new THREE.Group();
    this.scene.add(this.graphRoot);
    this.clusterRoot = new THREE.Group();
    this.scene.add(this.clusterRoot);

    this.pulsePoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0xb3f5ff, size: 3.8, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending })
    );
    this.scene.add(this.pulsePoints);

    this.cometTrail = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0x91e8ff, size: 2.6, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending })
    );
    this.scene.add(this.cometTrail);
  }

  async loadData() {
    try {
      const apiPath = this.apiUrl.startsWith('/api/') ? this.apiUrl.slice(5) : this.apiUrl.replace(/^\//, '');
      if (this._hass?.callApi) {
        this.data = await this._hass.callApi('GET', apiPath);
      } else {
        const response = await fetch(this.apiUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        this.data = await response.json();
      }
      this.buildNodes();
      this.rebuildScene();
      this.updateControlPills();
      this.applyVisibility();
      this.selectedNode = {
        title: this.data.core.title,
        type: 'core',
        group: 'core',
        text: this.data.core.text,
        meta: `${this.data.meta.memory_count} memories · ${this.data.meta.top_skill_count} visible skills`,
      };
      this.updateFilters();
      this.updateSidePanel();
      this.updateFocusLane();
      this.drawMiniMap();
    } catch (err) {
      this.detailsEl.innerHTML = `<h3>Could not load data</h3><div class="detail-body">${this.escapeHtml(String(err?.message || err))}</div>`;
    }
  }

  colorFor(node) {
    if (node.type === 'memory') return 0x7ee7ff;
    if (node.type === 'skill') return 0xae8cff;
    if (node.type === 'profile') return 0xffb86d;
    if (node.type === 'tool') return 0x79f0ae;
    return 0xd9e7ff;
  }

  colorCss(node) {
    if (node.type === 'memory') return '#7ee7ff';
    if (node.type === 'skill') return '#ae8cff';
    if (node.type === 'profile') return '#ffb86d';
    if (node.type === 'tool') return '#79f0ae';
    return '#d9e7ff';
  }

  buildNodes() {
    if (!this.data) return;
    const clusters = this.clusterConfigs;
    const jitter = (seed, scale) => (Math.sin(seed * 12.9898) + Math.cos(seed * 78.233)) * 0.5 * scale;
    const groups = [];
    const timelineSource = [
      ...this.data.memories,
      ...this.data.profile,
      ...this.data.skills,
      ...this.data.tools,
    ];
    timelineSource.sort((a, b) => String(a.updated_at || a.created_at || a.last_used_at || '').localeCompare(String(b.updated_at || b.created_at || b.last_used_at || '')));
    const timelineOrder = new Map(timelineSource.map((item, idx) => [item.id, idx]));
    const pack = (items, type) => {
      const cluster = clusters[type];
      items.forEach((item, idx) => {
        const s = idx + 1;
        const count = Math.max(items.length, 1);
        const theta = (idx / count) * Math.PI * 2.6 + jitter(s, 0.35);
        const phi = ((idx * 1.618) % count) / count * Math.PI;
        const radial = 0.38 + ((idx % 7) / 6) * 0.64;
        const basePosition = new THREE.Vector3(
          cluster.center.x + Math.cos(theta) * Math.sin(phi + 0.4) * cluster.spread.x * radial + jitter(s * 0.7, 16),
          cluster.center.y + Math.sin(theta * 1.3) * cluster.spread.y * radial + jitter(s * 1.1, 10),
          cluster.center.z + Math.cos(phi) * cluster.spread.z * radial + jitter(s * 0.4, 14)
        );
        const tIndex = timelineOrder.get(item.id) ?? idx;
        const lineX = -180 + (tIndex / Math.max(timelineSource.length - 1, 1)) * 360;
        const typeBand = { memory: -65, profile: -18, skill: 28, tool: 78 }[type] || 0;
        const timelinePosition = new THREE.Vector3(
          lineX,
          typeBand + jitter(s * 0.9, 10),
          Math.sin((tIndex + 1) * 0.7) * 40 + jitter(s * 0.5, 8)
        );
        groups.push({
          ...item,
          type,
          basePosition,
          timelinePosition,
          position: basePosition.clone(),
          drift: 0.18 + (idx % 5) * 0.05,
          wobble: 3.5 + (idx % 4) * 1.2,
          phase: theta,
          size: cluster.baseSize + (item.importance || 0.4) * 3.9,
          alpha: 0.42 + (item.importance || 0.4) * 0.45,
          searchable: `${item.title || ''} ${item.text || ''} ${item.group || ''} ${item.category || ''} ${item.meta || ''}`.toLowerCase(),
        });
      });
    };

    pack(this.data.memories, 'memory');
    pack(this.data.profile, 'profile');
    pack(this.data.skills, 'skill');
    pack(this.data.tools, 'tool');
    this.nodes = groups;
    this.updateTopSkills();
  }

  rebuildScene() {
    while (this.graphRoot.children.length) {
      const child = this.graphRoot.children.pop();
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material.dispose?.();
      }
      if (child.parent) child.parent.remove(child);
    }
    while (this.clusterRoot.children.length) {
      const child = this.clusterRoot.children.pop();
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) child.material.dispose?.();
      if (child.parent) child.parent.remove(child);
    }

    this.linkPairs = [];
    this.nodeObjects = [];
    this.nodeMap = new Map();
    this.labelEls = new Map();
    this.labelsEl.innerHTML = '';
    this.clusterZones = [];

    Object.entries(this.clusterConfigs).forEach(([type, cfg]) => {
      const zone = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(cfg.spread.x, cfg.spread.y, cfg.spread.z) * 0.62, 36, 36),
        new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.045 })
      );
      zone.position.copy(cfg.center);
      zone.scale.set(cfg.spread.x / 90, cfg.spread.y / 90, cfg.spread.z / 90);
      this.clusterRoot.add(zone);
      this.clusterZones.push({ type, mesh: zone, label: cfg.label });

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(cfg.spread.x, cfg.spread.z) * 0.58, 0.26, 12, 100),
        new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.12 })
      );
      ring.position.copy(cfg.center);
      ring.rotation.x = 1.28;
      this.clusterRoot.add(ring);
      this.clusterZones.push({ type, mesh: ring, label: cfg.label });
    });

    const sphereGeo = new THREE.SphereGeometry(1, 20, 20);
    for (const node of this.nodes) {
      const color = this.colorFor(node);
      const shellMaterial = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.75,
        roughness: 0.34,
        metalness: 0.04,
        transparent: true,
        opacity: Math.min(0.98, node.alpha),
      });
      const mesh = new THREE.Mesh(sphereGeo.clone(), shellMaterial);
      mesh.position.copy(node.position);
      mesh.scale.setScalar(node.size);
      mesh.userData.node = node;

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 18, 18),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08 })
      );
      halo.scale.setScalar(node.size * 1.72);
      mesh.add(halo);
      mesh.userData.halo = halo;

      this.graphRoot.add(mesh);
      this.nodeObjects.push(mesh);
      this.nodeMap.set(node.id, mesh);
      this.labelsEl.appendChild(this.createLabelElement(node));
    }

    const linkPositions = [];
    const linkPairs = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      const neighbors = [];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        const baseDist = a.basePosition.distanceTo(b.basePosition);
        const threshold = a.type === b.type ? 74 : 60;
        if (baseDist < threshold) neighbors.push({ b, baseDist });
      }
      neighbors.sort((x, y) => x.baseDist - y.baseDist);
      for (const { b } of neighbors.slice(0, a.importance > 0.72 ? 3 : 2)) {
        linkPositions.push(a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z);
        linkPairs.push({ a: this.nodeMap.get(a.id), b: this.nodeMap.get(b.id), speed: 0.35 + ((i + b.size) % 4) * 0.12 });
      }
    }

    this.linkPairs = linkPairs;
    if (linkPositions.length) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linkPositions, 3));
      const lineMat = new THREE.LineBasicMaterial({ color: 0x86c2ff, transparent: true, opacity: 0.16 });
      this.lines = new THREE.LineSegments(lineGeo, lineMat);
      this.graphRoot.add(this.lines);
      this.updatePulseGeometry();
    }
  }

  updatePulseGeometry() {
    const count = Math.min(this.linkPairs.length, 110);
    this.pulseCount = count;
    this.pulseProgress = Array.from({ length: count }, (_, idx) => (idx / Math.max(count, 1)) % 1);
    this.pulseSpeeds = Array.from({ length: count }, (_, idx) => this.linkPairs[idx]?.speed || 0.5);
    const positions = new Float32Array(count * 3);
    this.pulsePoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  }

  createLabelElement(node) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'node-label';
    el.dataset.id = node.id;
    el.dataset.type = node.type;
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = node.title || node.id;
    const meta = document.createElement('span');
    meta.className = 'm';
    meta.textContent = node.meta || node.group || node.category || node.type;
    el.append(title, meta);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.selectNodeById(node.id);
    });
    this.labelEls.set(node.id, el);
    return el;
  }

  installEvents() {
    this.renderer.domElement.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    this.renderer.domElement.addEventListener('pointerleave', () => {
      this.hoveredNode = null;
      this.tooltipEl.classList.remove('visible');
    });
    this.renderer.domElement.addEventListener('click', () => this.onClick());
    this.searchEl?.addEventListener('input', (ev) => {
      this.searchQuery = (ev.target.value || '').trim().toLowerCase();
      this.applyVisibility();
      this.updateFocusLane();
      this.updateSidePanel();
    });
  }

  onPointerMove(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointer.set(x, y);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.nodeObjects.filter((mesh) => mesh.visible));
    const hit = hits[0]?.object?.userData?.node || null;
    this.hoveredNode = hit;
    if (hit) {
      this.tooltipEl.textContent = hit.title;
      this.tooltipEl.style.left = `${ev.clientX - rect.left}px`;
      this.tooltipEl.style.top = `${ev.clientY - rect.top}px`;
      this.tooltipEl.classList.add('visible');
      if (this.hoveredNode !== this.selectedNode) this.updateHoverDetails();
    } else {
      this.tooltipEl.classList.remove('visible');
    }
  }

  onClick() {
    if (!this.hoveredNode) return;
    this.selectedNode = this.hoveredNode;
    this.updateSidePanel();
    this.updateFocusLane();
    const mesh = this.nodeMap.get(this.selectedNode.id);
    if (mesh) this.controls.target.lerp(mesh.position, 0.35);
  }

  selectNodeById(id) {
    const mesh = this.nodeMap.get(id);
    const node = mesh?.userData?.node;
    if (!node) return;
    this.selectedNode = node;
    this.updateSidePanel();
    this.updateFocusLane();
    this.controls.target.lerp(mesh.position, 0.4);
  }

  updateControlPills() {
    const build = (host, current, items, onSelect) => {
      host.innerHTML = '';
      items.forEach(([value, label]) => {
        const button = document.createElement('button');
        button.className = 'pill';
        button.textContent = label;
        if (current === value) button.classList.add('active');
        button.addEventListener('click', () => onSelect(value));
        host.appendChild(button);
      });
    };

    build(this.viewModeEl, this.viewMode, [
      ['constellation', 'Constellations'],
      ['timeline', 'Timeline'],
    ], (value) => {
      this.viewMode = value;
      this.updateControlPills();
      this.updateFocusLane();
      this.drawMiniMap();
    });

    build(this.labelModeEl, this.labelMode, [
      ['smart', 'Labels smart'],
      ['all', 'Labels all'],
      ['off', 'Labels off'],
    ], (value) => {
      this.labelMode = value;
      this.updateControlPills();
      this.updateFocusLane();
    });

    build(this.motionModeEl, this.motionMode, [
      ['calm', 'Motion calm'],
      ['live', 'Motion live'],
      ['still', 'Motion still'],
    ], (value) => {
      this.motionMode = value;
      this.autoDrift = value === 'live' ? 0.0001 : value === 'still' ? 0 : 0.00004;
      this.updateControlPills();
    });
  }

  updateFilters() {
    const modes = [
      ['all', 'All'],
      ['memory', 'Add-ons'],
      ['skill', 'Enheter'],
      ['profile', 'Integrationer'],
      ['tool', 'Entiteter'],
    ];
    this.filterEl.innerHTML = '';
    modes.forEach(([value, label]) => {
      const button = document.createElement('button');
      button.textContent = label;
      if (this.mode === value) button.classList.add('active');
      button.addEventListener('click', () => {
        this.mode = value;
        this.applyVisibility();
        this.updateFilters();
        this.updateFocusLane();
      });
      this.filterEl.appendChild(button);
    });
  }

  matchesSearch(node) {
    return !this.searchQuery || node.searchable.includes(this.searchQuery);
  }

  applyVisibility() {
    for (const mesh of this.nodeObjects) {
      const node = mesh.userData.node;
      const typeMatch = this.mode === 'all' || node.type === this.mode;
      mesh.visible = typeMatch && this.matchesSearch(node);
      const label = this.labelEls.get(node.id);
      if (label) label.style.opacity = '0';
    }
    if (this.lines) this.lines.visible = this.mode === 'all' || !!this.searchQuery;
    this.drawMiniMap();
  }

  visibleNodesSorted() {
    return this.nodeObjects
      .filter((mesh) => mesh.visible)
      .map((mesh) => mesh.userData.node)
      .sort((a, b) => (b.importance || 0) - (a.importance || 0));
  }

  updateTopSkills() {
    const el = this.shadowRoot.getElementById('topskills');
    if (!this.data) return;
    el.innerHTML = '';
    this.data.skills.slice(0, 8).forEach((skill) => {
      const button = document.createElement('button');
      button.className = 'row';
      button.innerHTML = `
        <strong>${this.escapeHtml(skill.title)}</strong>
        <small>${this.escapeHtml(skill.meta || skill.category || '')}</small>
      `;
      button.addEventListener('click', () => this.selectNodeById(skill.id));
      el.appendChild(button);
    });
  }

  updateFocusLane() {
    if (!this.focusListEl) return;
    const items = this.visibleNodesSorted();
    const picks = [];
    const seen = new Set();
    [this.selectedNode, this.hoveredNode].forEach((node) => {
      if (node?.id && !seen.has(node.id) && this.nodeMap.get(node.id)?.visible) {
        picks.push(node);
        seen.add(node.id);
      }
    });
    items.forEach((node) => {
      if (picks.length >= 8 || seen.has(node.id)) return;
      picks.push(node);
      seen.add(node.id);
    });

    this.focusListEl.innerHTML = '';
    picks.forEach((item) => {
      const button = document.createElement('button');
      button.className = 'focus-row';
      button.innerHTML = `
        <strong>${this.escapeHtml(item.title)}</strong>
        <small>${this.escapeHtml(item.meta || item.group || item.category || item.type)}</small>
      `;
      button.addEventListener('click', () => this.selectNodeById(item.id));
      this.focusListEl.appendChild(button);
    });
  }

  updateSidePanel() {
    if (!this.data) return;
    const visibleCount = this.visibleNodesSorted().length;
    this.statsEl.innerHTML = `
      <div class="stat"><div class="v">${this.data.meta.memory_count}</div><div class="k">Add-ons</div></div>
      <div class="stat"><div class="v">${this.data.meta.profile_count}</div><div class="k">Integrationer</div></div>
      <div class="stat"><div class="v">${this.data.meta.fact_count || 0}</div><div class="k">Enheter</div></div>
      <div class="stat"><div class="v">${visibleCount}</div><div class="k">Visible nodes</div></div>
    `;
    const item = this.selectedNode;
    if (!item) return;
    const chips = [];
    if (item.group) chips.push(item.group);
    if (item.category) chips.push(item.category);
    if (item.use_count != null) chips.push(`uses ${item.use_count}`);
    if (item.view_count != null) chips.push(`views ${item.view_count}`);
    if (item.patch_count != null) chips.push(`patches ${item.patch_count}`);
    if (item.meta) chips.push(item.meta);
    if (item.updated_at) chips.push(`updated ${item.updated_at}`);
    if (item.created_at && item.created_at !== item.updated_at) chips.push(`created ${item.created_at}`);

    this.detailsEl.innerHTML = `
      <div class="detail-type">${this.escapeHtml(item.type || 'core')}</div>
      <h3>${this.escapeHtml(item.title)}</h3>
      <div class="detail-body">${this.escapeHtml(item.text || '')}</div>
      <div class="chips">${chips.map((chip) => `<span class="chip">${this.escapeHtml(chip)}</span>`).join('')}</div>
    `;
  }

  updateHoverDetails() {
    if (!this.hoveredNode) return;
    const item = this.hoveredNode;
    this.detailsEl.innerHTML = `
      <div class="detail-type">hover · ${this.escapeHtml(item.type)}</div>
      <h3>${this.escapeHtml(item.title)}</h3>
      <div class="detail-body">${this.escapeHtml(item.text || '')}</div>
      <div class="chips">
        <span class="chip">${this.escapeHtml(item.group || item.category || 'node')}</span>
        ${item.use_count != null ? `<span class="chip">uses ${this.escapeHtml(item.use_count)}</span>` : ''}
        ${item.meta ? `<span class="chip">${this.escapeHtml(item.meta)}</span>` : ''}
      </div>
    `;
  }

  updateLabelAnchors() {
    if (!this.camera || !this.width || !this.height) return;
    const preferred = this.visibleNodesSorted();
    const chosenIds = new Set();
    if (this.labelMode !== 'off') {
      [this.selectedNode, this.hoveredNode].forEach((node) => node?.id && chosenIds.add(node.id));
      const max = this.labelMode === 'all' ? 26 : 12;
      preferred.forEach((node) => {
        if (chosenIds.size >= max) return;
        if (this.labelMode === 'all' || (node.importance || 0) >= 0.72 || this.matchesSearch(node)) {
          chosenIds.add(node.id);
        }
      });
    }

    this.labelEls.forEach((el, id) => {
      const mesh = this.nodeMap.get(id);
      if (!mesh?.visible || !chosenIds.has(id) || this.labelMode === 'off') {
        el.style.opacity = '0';
        el.classList.remove('active');
        return;
      }
      const screen = mesh.position.clone().project(this.camera);
      const inFront = screen.z > -1 && screen.z < 1;
      const inBounds = screen.x > -1.12 && screen.x < 1.12 && screen.y > -1.12 && screen.y < 1.12;
      if (!inFront || !inBounds) {
        el.style.opacity = '0';
        el.classList.remove('active');
        return;
      }
      const x = (screen.x * 0.5 + 0.5) * this.width;
      const y = (-screen.y * 0.5 + 0.5) * this.height - Math.max(26, mesh.scale.x * 2.6);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = String(this.selectedNode?.id === id || this.hoveredNode?.id === id ? 1 : 0.84);
      if (this.selectedNode?.id === id || this.hoveredNode?.id === id) el.classList.add('active');
      else el.classList.remove('active');
    });
  }

  drawMiniMap() {
    if (!this.miniMapCtx || !this.miniMapEl) return;
    const ctx = this.miniMapCtx;
    const w = this.miniMapEl.width;
    const h = this.miniMapEl.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(5, 9, 22, 0.96)';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(126, 180, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, i * 24, 0, Math.PI * 2);
      ctx.stroke();
    }

    const viewPos = (node) => this.viewMode === 'timeline' ? node.timelinePosition : node.basePosition;
    const visible = this.visibleNodesSorted();
    visible.forEach((node) => {
      const p = viewPos(node);
      const x = w / 2 + (p.x / 240) * 66;
      const y = h / 2 + (p.z / 240) * 66;
      ctx.beginPath();
      ctx.fillStyle = this.colorCss(node);
      ctx.globalAlpha = 0.85;
      ctx.arc(x, y, Math.max(2.1, node.size * 0.34), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    Object.entries(this.clusterConfigs).forEach(([type, cfg]) => {
      const center = this.viewMode === 'timeline'
        ? { x: { memory: -140, profile: -30, skill: 70, tool: 140 }[type], z: 0 }
        : { x: cfg.center.x, z: cfg.center.z };
      const x = w / 2 + (center.x / 240) * 66;
      const y = h / 2 + (center.z / 240) * 66;
      ctx.strokeStyle = `${this.colorCss({ type })}55`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.stroke();
    });

    const focus = this.selectedNode || this.hoveredNode;
    if (focus?.id) {
      const p = viewPos(focus);
      const x = w / 2 + (p.x / 240) * 66;
      const y = h / 2 + (p.z / 240) * 66;
      ctx.beginPath();
      ctx.fillStyle = '#ffffff';
      ctx.arc(x, y, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7ee7ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  resize() {
    if (!this.sceneHost || !this.renderer || !this.camera) return;
    const rect = this.sceneHost.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
    this.drawMiniMap();
  }

  animate(time) {
    const dt = Math.min(32, time - this.lastTime);
    this.lastTime = time;
    const t = time * 0.001;
    const motionFactor = this.motionMode === 'live' ? 1.9 : this.motionMode === 'still' ? 0 : 1;

    this.graphRoot.rotation.y += this.autoDrift * dt;
    this.coreGlow.scale.setScalar(1 + Math.sin(t * 1.2) * 0.06);
    this.coreShell.rotation.y -= this.autoDrift * dt * 3;
    this.coreShell.rotation.x += this.autoDrift * dt * 1.3;

    if (this.starfield) {
      this.starfield.rotation.y += 0.000012 * dt * (motionFactor || 0.2);
      this.starfield.rotation.x = Math.sin(t * 0.08) * 0.18;
    }
    this.rings?.forEach((ring, idx) => {
      ring.rotation.y += (0.00005 + idx * 0.000015) * dt * (motionFactor || 0.15);
      ring.rotation.z += (0.00003 + idx * 0.00001) * dt * (motionFactor || 0.1);
    });

    for (const zone of this.clusterZones) {
      zone.mesh.rotation.y += 0.00003 * dt * (motionFactor || 0.1);
      zone.mesh.rotation.x += 0.00001 * dt * (motionFactor || 0.08);
      if (this.viewMode === 'timeline') {
        zone.mesh.position.lerp(new THREE.Vector3(
          { memory: -140, profile: -40, skill: 50, tool: 140 }[zone.type] || 0,
          0,
          0
        ), 0.08);
      } else {
        const cfg = this.clusterConfigs[zone.type];
        zone.mesh.position.lerp(cfg.center, 0.08);
      }
    }

    const positions = this.pulsePoints.geometry.attributes.position?.array;
    for (const mesh of this.nodeObjects) {
      const node = mesh.userData.node;
      const targetBase = this.viewMode === 'timeline' ? node.timelinePosition : node.basePosition;
      const animated = new THREE.Vector3(
        targetBase.x + Math.cos(t * node.drift * motionFactor + node.phase) * node.wobble,
        targetBase.y + Math.sin(t * node.drift * 1.6 * motionFactor + node.phase) * (node.wobble * 0.45),
        targetBase.z + Math.sin(t * node.drift * 1.1 * motionFactor + node.phase * 0.7) * (node.wobble * 0.8)
      );
      node.position.lerp(animated, 0.12);
      mesh.position.copy(node.position);
      const active = this.hoveredNode?.id === node.id || this.selectedNode?.id === node.id;
      const scale = active ? node.size * 1.18 : node.size;
      mesh.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.18);
      mesh.material.emissiveIntensity = active ? 1.38 : 0.72;
      mesh.material.opacity = active ? 1 : Math.min(0.98, node.alpha);
      if (mesh.userData.halo) mesh.userData.halo.material.opacity = active ? 0.2 : 0.08;
    }

    const focusMesh = this.nodeMap.get(this.selectedNode?.id || this.hoveredNode?.id);
    if (focusMesh) {
      const pulse = 1.55 + Math.sin(t * 2.8) * 0.12;
      this.selectionAura.visible = true;
      this.selectionAura.position.copy(focusMesh.position);
      this.selectionAura.scale.setScalar(focusMesh.scale.x * pulse);
      this.selectionAura.material.opacity = this.selectedNode ? 0.18 : 0.1;
    } else {
      this.selectionAura.visible = false;
    }

    if (this.lines?.geometry && this.linkPairs?.length) {
      const pos = this.lines.geometry.attributes.position.array;
      let k = 0;
      this.linkPairs.forEach(({ a, b }, idx) => {
        pos[k++] = a.position.x; pos[k++] = a.position.y; pos[k++] = a.position.z;
        pos[k++] = b.position.x; pos[k++] = b.position.y; pos[k++] = b.position.z;
        if (positions && idx < this.pulseCount) {
          this.pulseProgress[idx] = (this.pulseProgress[idx] + dt * 0.00035 * this.pulseSpeeds[idx]) % 1;
          const p = this.pulseProgress[idx];
          positions[idx * 3] = a.position.x + (b.position.x - a.position.x) * p;
          positions[idx * 3 + 1] = a.position.y + (b.position.y - a.position.y) * p;
          positions[idx * 3 + 2] = a.position.z + (b.position.z - a.position.z) * p;
        }
      });
      this.lines.geometry.attributes.position.needsUpdate = true;
      if (this.pulsePoints.geometry.attributes.position) {
        this.pulsePoints.geometry.attributes.position.needsUpdate = true;
      }
    }

    const cometPositions = new Float32Array(48 * 3);
    for (let i = 0; i < 48; i++) {
      const p = i / 48;
      const angle = t * (0.35 + p * 0.6) + p * Math.PI * 2;
      const radius = 90 + p * 120;
      cometPositions[i * 3] = Math.cos(angle) * radius;
      cometPositions[i * 3 + 1] = Math.sin(angle * 1.7) * 22;
      cometPositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    this.cometTrail.geometry.setAttribute('position', new THREE.Float32BufferAttribute(cometPositions, 3));

    this.updateLabelAnchors();
    this.drawMiniMap();
    this.controls?.update();
    this.renderer?.render(this.scene, this.camera);
    this.raf = requestAnimationFrame((next) => this.animate(next));
  }
}

customElements.define('hermes-ha-cloud-panel', HermesHACloudPanel);
