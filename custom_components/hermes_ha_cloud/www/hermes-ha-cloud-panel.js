import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

class HermesHACloudPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = null;
    this.nodes = [];
    this.linkDefs = [];
    this.mode = 'active';
    this.viewMode = 'constellation';
    this.labelMode = 'normal';
    this.motionMode = 'calm';
    this.selectedNode = null;
    this.hoveredNode = null;
    this.searchQuery = '';
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.nodeObjects = [];
    this.nodeMap = new Map();
    this.labelEls = new Map();
    this.lastTime = performance.now();
    this.autoDrift = 0.00004;
    this.layerConfigs = this.createLayerConfigs();
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
    this.focusPathsEl = this.shadowRoot.getElementById('focuspaths');
    this.problemListEl = this.shadowRoot.getElementById('problemlist');
    this.relationsEl = this.shadowRoot.getElementById('relations');
    this.labelModeEl = this.shadowRoot.getElementById('labelmodes');
    this.motionModeEl = this.shadowRoot.getElementById('motionmodes');
    this.viewModeEl = this.shadowRoot.getElementById('viewmodes');
    this.miniMapEl = this.shadowRoot.getElementById('minimap');
    this.miniMapCtx = this.miniMapEl?.getContext('2d');
    this.initThree();
    this.installEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.sceneHost);
    this.resize();
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

  createLayerConfigs() {
    return {
      addon: { label: 'Add-ons', color: 0x6dd9ff, css: '#6dd9ff', center: new THREE.Vector3(-178, 54, 42), spread: new THREE.Vector3(34, 18, 24), baseSize: 1.95, band: -112 },
      integration: { label: 'Integrationer', color: 0xffb86d, css: '#ffb86d', center: new THREE.Vector3(-82, 22, 14), spread: new THREE.Vector3(44, 22, 28), baseSize: 2.2, band: -78 },
      area: { label: 'Areas / rum', color: 0x4bc0ff, css: '#4bc0ff', center: new THREE.Vector3(18, 60, 34), spread: new THREE.Vector3(42, 22, 28), baseSize: 2.35, band: -42 },
      device: { label: 'Enheter', color: 0xae8cff, css: '#ae8cff', center: new THREE.Vector3(128, 30, -6), spread: new THREE.Vector3(54, 32, 36), baseSize: 2.25, band: -2 },
      entity: { label: 'Entiteter', color: 0x79f0ae, css: '#79f0ae', center: new THREE.Vector3(0, -20, -126), spread: new THREE.Vector3(82, 26, 28), baseSize: 1.55, band: 38 },
      automation: { label: 'Automationer', color: 0xffe36c, css: '#ffe36c', center: new THREE.Vector3(-136, -54, -12), spread: new THREE.Vector3(34, 18, 24), baseSize: 2.0, band: 76 },
      scene: { label: 'Scener', color: 0xff9ecf, css: '#ff9ecf', center: new THREE.Vector3(-22, -82, 44), spread: new THREE.Vector3(28, 16, 22), baseSize: 2.0, band: 108 },
      person: { label: 'Personer', color: 0xc0f7ff, css: '#c0f7ff', center: new THREE.Vector3(90, -78, 56), spread: new THREE.Vector3(20, 14, 16), baseSize: 2.3, band: 138 },
      problem: { label: 'Problem-enheter', color: 0xff6b6b, css: '#ff6b6b', center: new THREE.Vector3(188, -8, 102), spread: new THREE.Vector3(20, 12, 14), baseSize: 3.05, band: 168 },
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
          --panel-strong: rgba(8, 13, 26, 0.92);
          --border: rgba(130, 175, 255, 0.12);
          --critical: #ff6b6b;
          --warning: #ffb347;
          --ok: #8bd3ff;
          font-family: Inter, system-ui, sans-serif;
        }
        * { box-sizing: border-box; }
        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1.78fr) minmax(360px, 0.92fr);
          height: 100vh;
          background:
            radial-gradient(circle at 18% 14%, rgba(58, 126, 255, 0.16), transparent 26%),
            radial-gradient(circle at 74% 20%, rgba(150, 88, 255, 0.14), transparent 24%),
            radial-gradient(circle at 54% 84%, rgba(56, 220, 187, 0.11), transparent 24%),
            linear-gradient(180deg, var(--bg1), var(--bg0));
        }
        .scene-wrap { position: relative; overflow: hidden; border-right: 1px solid var(--border); }
        #scene, .labels, .vignette, .grid-glow, .cinema-bar, .minimap-wrap { position: absolute; }
        #scene, .labels, .vignette, .grid-glow { inset: 0; }
        canvas.webgl { width: 100%; height: 100%; display: block; }
        .grid-glow {
          background:
            linear-gradient(transparent 0%, rgba(29, 71, 140, 0.09) 50%, transparent 100%),
            radial-gradient(circle at 50% 60%, rgba(111, 202, 255, 0.06), transparent 42%);
          mix-blend-mode: screen; pointer-events: none;
        }
        .vignette {
          background: radial-gradient(circle at center, transparent 46%, rgba(2, 4, 11, 0.26) 72%, rgba(2, 4, 11, 0.76) 100%);
          pointer-events: none; z-index: 3;
        }
        .cinema-bar { left: 0; right: 0; height: 28px; background: linear-gradient(180deg, rgba(0,0,0,0.72), rgba(0,0,0,0)); pointer-events: none; z-index: 3; }
        .cinema-bar.bottom { top: auto; bottom: 0; transform: rotate(180deg); }
        .labels { pointer-events: none; z-index: 5; }
        .node-label {
          position: absolute; transform: translate(-50%, -50%); padding: 8px 11px; border-radius: 12px;
          border: 1px solid rgba(160, 197, 255, 0.16); background: rgba(7, 12, 26, 0.62); backdrop-filter: blur(8px);
          color: #eef4ff; min-width: 96px; max-width: 240px; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.26);
          opacity: 0; transition: opacity 140ms ease, transform 140ms ease, border-color 140ms ease, background 140ms ease;
          pointer-events: auto; cursor: pointer;
        }
        .node-label:hover, .node-label.active { border-color: rgba(125, 215, 255, 0.34); background: rgba(12, 19, 39, 0.84); transform: translate(-50%, -50%) scale(1.04); }
        .node-label.critical { border-color: rgba(255, 107, 107, 0.65); box-shadow: 0 0 22px rgba(255, 107, 107, 0.18); }
        .node-label.warning { border-color: rgba(255, 179, 71, 0.5); }
        .node-label .t { display: block; font-size: 12px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .node-label .m { display: block; margin-top: 3px; color: #9fb3dd; font-size: 10px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hud { position: absolute; inset: 0 auto auto 0; width: min(860px, calc(100% - 28px)); margin: 16px; pointer-events: none; z-index: 4; }
        .headline { pointer-events: auto; background: linear-gradient(180deg, rgba(9,14,31,0.84), rgba(9,14,31,0.48)); border: 1px solid var(--border); border-radius: 18px; padding: 18px 20px; box-shadow: 0 14px 42px rgba(0,0,0,0.24); }
        .eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; color: #82b5ff; margin-bottom: 6px; }
        h1 { margin: 0; font-size: 30px; line-height: 1.1; }
        .sub { margin-top: 8px; max-width: 760px; color: #b0c0e8; font-size: 14px; line-height: 1.55; }
        .controls { display: grid; grid-template-columns: minmax(180px, 1.3fr) repeat(3, auto); gap: 12px; margin-top: 14px; align-items: center; }
        .search input { width: 100%; border-radius: 999px; border: 1px solid var(--border); background: rgba(5, 9, 20, 0.9); color: #eef4ff; padding: 11px 14px; outline: none; }
        .search input::placeholder { color: #8294bf; }
        .control-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .control-pills button, .filters button, .row, .focus-row, .relation-btn {
          border: 1px solid rgba(140, 180, 255, 0.16); background: rgba(14, 21, 42, 0.84); color: #eef4ff;
          padding: 9px 12px; border-radius: 999px; cursor: pointer; transition: 140ms ease; font: inherit;
        }
        .control-pills button.active, .filters button.active { background: rgba(36, 75, 164, 0.95); border-color: rgba(125, 215, 255, 0.34); }
        .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .legend span { border-radius: 999px; padding: 5px 10px; font-size: 12px; border: 1px solid rgba(140,180,255,0.14); background: rgba(10, 16, 30, 0.68); }
        .legend .critical { border-color: rgba(255,107,107,0.36); color: #ffaeae; }
        .minimap-wrap { right: 18px; bottom: 18px; z-index: 4; }
        canvas#minimap { width: 180px; height: 180px; display: block; border-radius: 18px; background: radial-gradient(circle at 50% 50%, rgba(21, 31, 58, 0.85), rgba(6, 10, 23, 0.96)); border: 1px solid rgba(146, 186, 255, 0.12); box-shadow: 0 16px 34px rgba(0, 0, 0, 0.28); }
        .minimap-copy { margin-top: 8px; text-align: center; font-size: 11px; color: #90a5d6; }
        aside { overflow: auto; padding: 14px; display: grid; gap: 12px; background: linear-gradient(180deg, rgba(5,9,20,0.9), rgba(4,7,16,0.96)); }
        .card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.18); }
        .card h2, .card h3 { margin: 0 0 8px 0; }
        .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .stat { background: rgba(9, 14, 28, 0.86); border: 1px solid rgba(140, 180, 255, 0.12); border-radius: 14px; padding: 10px 12px; }
        .stat .v { font-size: 22px; font-weight: 800; }
        .stat .k { color: #9fb3dd; font-size: 12px; }
        .stat.critical { border-color: rgba(255,107,107,0.38); background: rgba(41, 12, 18, 0.75); }
        .detail-type { color: #8db7ff; text-transform: uppercase; font-size: 11px; letter-spacing: 0.18em; }
        .detail-body { margin-top: 10px; color: #d6e2ff; line-height: 1.55; white-space: pre-wrap; }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .chip { padding: 6px 9px; border-radius: 999px; background: rgba(17, 25, 46, 0.9); border: 1px solid rgba(140,180,255,0.12); font-size: 12px; color: #dce7ff; }
        .chip.critical { border-color: rgba(255,107,107,0.4); color: #ffb0b0; }
        .chip.warning { border-color: rgba(255,179,71,0.4); color: #ffd296; }
        .focus-grid, .list, .relations, .focus-paths { display: grid; gap: 8px; }
        .row, .focus-row, .relation-btn { border-radius: 14px; text-align: left; display: flex; flex-direction: column; gap: 4px; }
        .row strong, .focus-row strong, .relation-btn strong { font-size: 13px; }
        .row small, .focus-row small, .relation-btn small { color: #95a8d7; }
        .path-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; border-radius: 14px; background: rgba(9, 14, 28, 0.72); border: 1px solid rgba(140, 180, 255, 0.12); }
        .path-node { border: 1px solid rgba(140, 180, 255, 0.16); background: rgba(14, 21, 42, 0.84); color: #eef4ff; padding: 7px 10px; border-radius: 999px; cursor: pointer; font: inherit; }
        .path-arrow { color: #7eaefb; font-size: 12px; }
        .microcopy { color: #96a8d7; font-size: 12px; line-height: 1.45; margin-top: 8px; }
        .empty { color: #90a5d6; font-size: 13px; }
        @media (max-width: 1320px) {
          .controls { grid-template-columns: 1fr; }
          .minimap-wrap { right: 14px; bottom: 14px; transform: scale(0.9); transform-origin: bottom right; }
          .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
              <div class="eyebrow">Home Assistant / topology observatory</div>
              <h1>Hermes HA Cloud</h1>
              <div class="sub">HA-specifik molnkarta där fokus ligger på aktiva och fungerande delar först. Problem, unavailable och trasiga delar finns kvar men filtreras in separat. Objekt är hårdare separerade för bättre läsbarhet och tydligare relationer.</div>
              <div class="controls">
                <label class="search"><input id="search" type="search" placeholder="Sök rum, enheter, integrationer, automations, personer..." /></label>
                <div class="control-group control-pills" id="viewmodes"></div>
                <div class="control-group control-pills" id="labelmodes"></div>
                <div class="control-group control-pills" id="motionmodes"></div>
              </div>
              <div class="filters" id="filters"></div>
              <div class="legend">
                <span>Add-ons</span>
                <span>Integrationer</span>
                <span>Areas</span>
                <span>Enheter</span>
                <span>Entiteter</span>
                <span>Automationer</span>
                <span>Scener</span>
                <span>Personer</span>
                <span class="critical">Unavailable / problem</span>
              </div>
            </div>
          </div>
          <div class="minimap-wrap">
            <canvas id="minimap" width="180" height="180"></canvas>
            <div class="minimap-copy">Layer map / live focus radar</div>
          </div>
        </div>
        <aside>
          <div class="card">
            <h2>Live snapshot</h2>
            <div class="stats" id="stats"></div>
          </div>
          <div class="card" id="details"></div>
          <div class="card">
            <h3>Kopplingar</h3>
            <div class="microcopy">Direkta relationer till vald nod: vilka saker den tillhör, styr, påverkar eller ligger i samma area som.</div>
            <div class="relations" id="relations"></div>
          </div>
          <div class="card">
            <h3>Focus lane</h3>
            <div class="microcopy">Viktigaste synliga noderna just nu. Problem och unavailable får extra vikt.</div>
            <div class="focus-grid" id="focuslist"></div>
          </div>
          <div class="card">
            <h3>Fokusvägar</h3>
            <div class="microcopy">Klickbara kedjor mellan rum, enhet, entitet och automation/scen för vald nod.</div>
            <div class="focus-paths" id="focuspaths"></div>
          </div>
          <div class="card">
            <h3>Problem-enheter</h3>
            <div class="microcopy">Enheter med unavailable- eller unknown-tyngd. Klicka för att följa kopplingarna.</div>
            <div class="list" id="problemlist"></div>
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
    this.controls.target.set(0, 0, 0);
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
    this.coreGlow = new THREE.Mesh(new THREE.SphereGeometry(18, 32, 32), new THREE.MeshBasicMaterial({ color: 0x85e8ff, transparent: true, opacity: 0.95 }));
    this.scene.add(this.coreGlow);
    this.coreShell = new THREE.Mesh(new THREE.SphereGeometry(36, 32, 32), new THREE.MeshBasicMaterial({ color: 0x4c69ff, transparent: true, opacity: 0.08 }));
    this.scene.add(this.coreShell);
    this.selectionAura = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), new THREE.MeshBasicMaterial({ color: 0xb9f4ff, transparent: true, opacity: 0.16 }));
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
    this.starfield = new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0x7fbfff, size: 1.6, transparent: true, opacity: 0.62 }));
    this.scene.add(this.starfield);

    this.rings = [];
    [
      { radius: 68, tube: 0.18, color: 0x5e79ff, tiltX: 1.05, tiltY: 0.35 },
      { radius: 96, tube: 0.16, color: 0x55d2ff, tiltX: 0.3, tiltY: 0.92 },
      { radius: 126, tube: 0.14, color: 0x83ffcb, tiltX: 1.34, tiltY: 0.12 },
    ].forEach((spec) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(spec.radius, spec.tube, 14, 140), new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.1 }));
      ring.rotation.x = spec.tiltX;
      ring.rotation.y = spec.tiltY;
      this.scene.add(ring);
      this.rings.push(ring);
    });

    this.graphRoot = new THREE.Group();
    this.scene.add(this.graphRoot);
    this.clusterRoot = new THREE.Group();
    this.scene.add(this.clusterRoot);
    this.pulsePoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xb3f5ff, size: 3.8, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending }));
    this.scene.add(this.pulsePoints);
  }

  async loadData() {
    try {
      const apiPath = this.apiUrl.startsWith('/api/') ? this.apiUrl.slice(5) : this.apiUrl.replace(/^\//, '');
      this.data = this._hass?.callApi ? await this._hass.callApi('GET', apiPath) : await (await fetch(this.apiUrl, { credentials: 'same-origin' })).json();
      this.buildNodes();
      this.rebuildScene();
      this.updateControlPills();
      this.selectedNode = { title: this.data.core.title, type: 'core', layer: 'core', group: 'core', text: this.data.core.text, meta: `${this.data.meta.integration_count} integrationer · ${this.data.meta.link_count} kopplingar` };
      this.updateFilters();
      this.applyVisibility();
      this.updateSidePanel();
      this.updateProblemList();
      this.updateFocusLane();
      this.drawMiniMap();
    } catch (err) {
      this.detailsEl.innerHTML = `<h3>Could not load data</h3><div class="detail-body">${this.escapeHtml(String(err?.message || err))}</div>`;
    }
  }

  getAllCollections() {
    return [
      ['addon', this.data?.addons || []],
      ['integration', this.data?.integrations || []],
      ['area', this.data?.areas || []],
      ['device', this.data?.devices || []],
      ['entity', this.data?.entities || []],
      ['automation', this.data?.automations || []],
      ['scene', this.data?.scenes || []],
      ['person', this.data?.persons || []],
      ['problem', this.data?.problem_devices || []],
    ];
  }

  colorFor(node) {
    if (node.severity === 'critical') return 0xff6b6b;
    if (node.severity === 'warning') return 0xffb347;
    return this.layerConfigs[node.layer]?.color || 0xd9e7ff;
  }

  colorCss(node) {
    if (node.severity === 'critical') return '#ff6b6b';
    if (node.severity === 'warning') return '#ffb347';
    return this.layerConfigs[node.layer]?.css || '#d9e7ff';
  }

  buildNodes() {
    if (!this.data) return;
    const jitter = (seed, scale) => (Math.sin(seed * 12.9898) + Math.cos(seed * 78.233)) * 0.5 * scale;
    const groups = [];
    const allItems = this.getAllCollections().flatMap(([, items]) => items);
    const timelineOrder = new Map(allItems.map((item, idx) => [item.id, idx]));
    const areaAnchors = new Map();

    const pack = (items, layer) => {
      const cluster = this.layerConfigs[layer];
      items.forEach((item, idx) => {
        const s = idx + 1;
        const count = Math.max(items.length, 1);
        const theta = (idx / count) * Math.PI * 2.4 + jitter(s, 0.4);
        const phi = ((idx * 1.618) % count) / count * Math.PI;
        const radial = 0.32 + ((idx % 7) / 6) * 0.7;
        const basePosition = new THREE.Vector3(
          cluster.center.x + Math.cos(theta) * Math.sin(phi + 0.4) * cluster.spread.x * radial + jitter(s * 0.7, 10),
          cluster.center.y + Math.sin(theta * 1.25) * cluster.spread.y * radial + jitter(s * 1.1, 8),
          cluster.center.z + Math.cos(phi) * cluster.spread.z * radial + jitter(s * 0.4, 10)
        );
        const tIndex = timelineOrder.get(item.id) ?? idx;
        const lineX = -180 + (tIndex / Math.max(allItems.length - 1, 1)) * 360;
        const timelinePosition = new THREE.Vector3(lineX, cluster.band + jitter(s * 0.9, 7), Math.sin((tIndex + 1) * 0.7) * 34 + jitter(s * 0.5, 7));
        const node = {
          ...item,
          layer,
          type: layer,
          basePosition,
          timelinePosition,
          position: basePosition.clone(),
          drift: layer === 'problem' ? 0.1 : 0.18 + (idx % 5) * 0.05,
          wobble: layer === 'problem' ? 1.6 : 2.8 + (idx % 4) * 1.1,
          phase: theta,
          size: cluster.baseSize + (item.importance || 0.4) * (layer === 'problem' ? 3.2 : 2.45),
          alpha: item.severity === 'critical' ? 0.94 : 0.42 + (item.importance || 0.4) * 0.45,
          searchable: `${item.title || ''} ${item.text || ''} ${item.group || ''} ${item.category || ''} ${item.meta || ''}`.toLowerCase(),
        };
        groups.push(node);
        if (layer === 'area' && item.area_id) {
          areaAnchors.set(item.area_id, { basePosition: basePosition.clone(), timelinePosition: timelinePosition.clone() });
        }
      });
    };

    pack(this.data?.addons || [], 'addon');
    pack(this.data?.integrations || [], 'integration');
    pack(this.data?.areas || [], 'area');
    pack(this.data?.devices || [], 'device');
    pack(this.data?.entities || [], 'entity');
    pack(this.data?.automations || [], 'automation');
    pack(this.data?.scenes || [], 'scene');
    pack(this.data?.persons || [], 'person');
    pack(this.data?.problem_devices || [], 'problem');

    groups.forEach((node, idx) => {
      const anchor = node.area_id ? areaAnchors.get(node.area_id) : null;
      if (!anchor) return;
      const s = idx + 1;
      const orbit = new THREE.Vector3(jitter(s * 0.71, 18), jitter(s * 0.43, 10), jitter(s * 0.97, 16));
      if (node.layer === 'device') {
        node.basePosition = anchor.basePosition.clone().add(orbit.clone().multiplyScalar(0.85));
        node.timelinePosition = anchor.timelinePosition.clone().add(new THREE.Vector3(16, 10, 0));
      } else if (node.layer === 'entity') {
        node.basePosition = anchor.basePosition.clone().add(orbit.clone().multiplyScalar(1.15)).add(new THREE.Vector3(0, -28, 0));
        node.timelinePosition = anchor.timelinePosition.clone().add(new THREE.Vector3(34, 22, 0));
      } else if (node.layer === 'automation' || node.layer === 'scene') {
        node.basePosition = anchor.basePosition.clone().add(orbit.clone().multiplyScalar(0.75)).add(new THREE.Vector3(-18, -42, 20));
      } else if (node.layer === 'person') {
        node.basePosition = anchor.basePosition.clone().add(orbit.clone().multiplyScalar(0.55)).add(new THREE.Vector3(0, 30, 16));
      } else if (node.layer === 'problem') {
        node.basePosition = anchor.basePosition.clone().add(new THREE.Vector3(42, -12, 42)).add(orbit.clone().multiplyScalar(0.35));
      }
      node.position = node.basePosition.clone();
    });

    this.nodes = groups;
    this.linkDefs = this.data.links || [];
  }

  rebuildScene() {
    while (this.graphRoot.children.length) {
      const child = this.graphRoot.children.pop();
      child.geometry?.dispose?.();
      if (child.material) Array.isArray(child.material) ? child.material.forEach((m) => m.dispose?.()) : child.material.dispose?.();
      child.parent?.remove(child);
    }
    while (this.clusterRoot.children.length) {
      const child = this.clusterRoot.children.pop();
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      child.parent?.remove(child);
    }

    this.nodeObjects = [];
    this.nodeMap = new Map();
    this.labelEls = new Map();
    this.labelsEl.innerHTML = '';

    Object.entries(this.layerConfigs).forEach(([layer, cfg]) => {
      const zone = new THREE.Mesh(new THREE.SphereGeometry(Math.max(cfg.spread.x, cfg.spread.y, cfg.spread.z) * 0.54, 32, 32), new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: layer === 'problem' ? 0.08 : 0.04 }));
      zone.position.copy(cfg.center);
      zone.scale.set(cfg.spread.x / 78, cfg.spread.y / 78, cfg.spread.z / 78);
      this.clusterRoot.add(zone);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(cfg.spread.x, cfg.spread.z) * 0.46, 0.22, 12, 90), new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: layer === 'problem' ? 0.22 : 0.1 }));
      ring.position.copy(cfg.center);
      ring.rotation.x = 1.2;
      this.clusterRoot.add(ring);
    });

    const sphereGeo = new THREE.SphereGeometry(1, 20, 20);
    for (const node of this.nodes) {
      const color = this.colorFor(node);
      const shellMaterial = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: node.severity === 'critical' ? 1.2 : 0.75, roughness: 0.34, metalness: 0.04, transparent: true, opacity: Math.min(0.98, node.alpha) });
      const mesh = new THREE.Mesh(sphereGeo.clone(), shellMaterial);
      mesh.position.copy(node.position);
      mesh.scale.setScalar(node.size);
      mesh.userData.node = node;
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1.2, 18, 18), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: node.severity === 'critical' ? 0.22 : 0.08 }));
      halo.scale.setScalar(node.size * (node.severity === 'critical' ? 2.05 : 1.72));
      mesh.add(halo);
      mesh.userData.halo = halo;
      this.graphRoot.add(mesh);
      this.nodeObjects.push(mesh);
      this.nodeMap.set(node.id, mesh);
      this.labelsEl.appendChild(this.createLabelElement(node));
    }

    const pairs = [];
    const positions = [];
    for (const link of this.linkDefs) {
      const a = this.nodeMap.get(link.source);
      const b = this.nodeMap.get(link.target);
      if (!a || !b) continue;
      pairs.push({ a, b, relation: link.relation, weight: link.weight || 1, key: `${link.source}|${link.target}|${link.relation}` });
      positions.push(a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z);
    }
    this.linkPairs = pairs;
    if (positions.length) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      this.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x86c2ff, transparent: true, opacity: 0.18 }));
      this.graphRoot.add(this.lines);
      this.updatePulseGeometry();
    } else {
      this.lines = null;
      this.pulsePoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(0), 3));
    }
  }

  updatePulseGeometry() {
    const count = Math.min(this.linkPairs.length, 260);
    this.pulseCount = count;
    this.pulseProgress = Array.from({ length: count }, (_, idx) => (idx / Math.max(count, 1)) % 1);
    this.pulseSpeeds = Array.from({ length: count }, (_, idx) => 0.6 + ((idx % 5) * 0.08));
    const positions = new Float32Array(count * 3);
    this.pulsePoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  }

  createLabelElement(node) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `node-label ${node.severity || 'ok'}`;
    el.dataset.id = node.id;
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = node.title || node.id;
    const meta = document.createElement('span');
    meta.className = 'm';
    meta.textContent = node.meta || node.group || node.category || node.type;
    el.append(title, meta);
    el.addEventListener('click', (ev) => { ev.stopPropagation(); this.selectNodeById(node.id); });
    this.labelEls.set(node.id, el);
    return el;
  }

  installEvents() {
    this.renderer.domElement.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    this.renderer.domElement.addEventListener('pointerleave', () => { this.hoveredNode = null; this.updateSidePanel(); });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.hoveredNode?.id) this.selectNodeById(this.hoveredNode.id);
      else { this.selectedNode = { title: this.data?.core?.title || 'Hermes HA Cloud', type: 'core', layer: 'core', text: this.data?.core?.text || '' }; this.updateSidePanel(); }
    });
    this.searchEl?.addEventListener('input', (ev) => {
      this.searchQuery = String(ev.target.value || '').trim().toLowerCase();
      this.applyVisibility();
      this.updateFocusLane();
      this.updateSidePanel();
    });
  }

  onPointerMove(ev) {
    if (!this.renderer || !this.camera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.nodeObjects);
    const hit = hits.find((entry) => entry.object?.userData?.node && entry.object.visible);
    this.hoveredNode = hit?.object?.userData?.node || null;
    this.updateSidePanel();
  }

  updateControlPills() {
    const build = (host, active, entries, onPick) => {
      if (!host) return;
      host.innerHTML = '';
      entries.forEach(([value, label]) => {
        const button = document.createElement('button');
        button.textContent = label;
        if (active === value) button.classList.add('active');
        button.addEventListener('click', () => onPick(value));
        host.appendChild(button);
      });
    };
    build(this.viewModeEl, this.viewMode, [['constellation', 'Constellation'], ['timeline', 'Timeline']], (value) => { this.viewMode = value; this.drawMiniMap(); });
    build(this.labelModeEl, this.labelMode, [['minimal', 'Minimal labels'], ['normal', 'Normal'], ['detailed', 'Detailed']], (value) => { this.labelMode = value; this.updateControlPills(); this.updateFocusLane(); });
    build(this.motionModeEl, this.motionMode, [['calm', 'Motion calm'], ['live', 'Motion live'], ['still', 'Motion still']], (value) => { this.motionMode = value; this.autoDrift = value === 'live' ? 0.0001 : value === 'still' ? 0 : 0.00004; this.updateControlPills(); });
  }

  updateFilters() {
    const modes = [
      ['active', 'Aktiva nu'], ['all', 'Alla'], ['problem', 'Problem'], ['unavailable', 'Unavailable'], ['addon', 'Add-ons'], ['integration', 'Integrationer'], ['area', 'Areas'], ['device', 'Enheter'], ['entity', 'Entiteter'], ['automation', 'Automationer'], ['scene', 'Scener'], ['person', 'Personer'],
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
        this.updateSidePanel();
      });
      this.filterEl.appendChild(button);
    });
  }

  matchesSearch(node) { return !this.searchQuery || node.searchable.includes(this.searchQuery); }
  modeMatches(node) {
    if (this.mode === 'active') {
      if (node.layer === 'problem') return false;
      if (node.severity === 'critical' || node.state === 'unavailable' || node.state === 'unknown') return false;
      if (node.layer === 'entity') return ['on', 'home', 'playing', 'open', 'armed_home', 'armed_away', 'triggered'].includes(node.state);
      if (node.layer === 'person') return node.state === 'home';
      if (node.layer === 'device' || node.layer === 'integration' || node.layer === 'area') return (node.view_count || 0) === 0;
      return true;
    }
    if (this.mode === 'all') return true;
    if (this.mode === 'unavailable') return node.severity === 'critical' || node.state === 'unavailable';
    return node.layer === this.mode;
  }

  applyVisibility() {
    for (const mesh of this.nodeObjects) {
      const node = mesh.userData.node;
      mesh.visible = this.modeMatches(node) && this.matchesSearch(node);
      const label = this.labelEls.get(node.id);
      if (label) label.style.opacity = '0';
    }
    if (this.lines) this.lines.visible = true;
    this.drawMiniMap();
  }

  visibleNodesSorted() {
    return this.nodeObjects.filter((mesh) => mesh.visible).map((mesh) => mesh.userData.node).sort((a, b) => {
      const aw = (a.severity === 'critical' ? 10 : a.severity === 'warning' ? 4 : 0) + (a.importance || 0);
      const bw = (b.severity === 'critical' ? 10 : b.severity === 'warning' ? 4 : 0) + (b.importance || 0);
      return bw - aw;
    });
  }

  selectNodeById(id) {
    const mesh = this.nodeMap.get(id);
    if (!mesh) return;
    this.selectedNode = mesh.userData.node;
    this.updateSidePanel();
    this.updateFocusLane();
    this.drawMiniMap();
  }

  getRelatedNodes(node) {
    if (!node?.id) return [];
    const seen = new Map();
    (this.linkDefs || []).forEach((link) => {
      let otherId = null;
      let relation = link.relation;
      if (link.source === node.id) otherId = link.target;
      else if (link.target === node.id) { otherId = link.source; relation = `← ${relation}`; }
      if (!otherId) return;
      const other = this.nodeMap.get(otherId)?.userData?.node;
      if (!other) return;
      if (!seen.has(otherId)) seen.set(otherId, { ...other, relation, weight: link.weight || 1 });
    });
    return [...seen.values()].sort((a, b) => ((b.severity === 'critical') - (a.severity === 'critical')) || ((b.importance || 0) - (a.importance || 0))).slice(0, 16);
  }

  getNodeById(id) {
    return this.nodeMap.get(id)?.userData?.node || null;
  }

  buildHierarchyPaths(node) {
    if (!node?.id) return [];
    const paths = [];
    const areaNode = node.area_id ? this.getNodeById(`area-${node.area_id}`) : null;
    const deviceNode = node.device_id ? this.getNodeById(`device-${node.device_id}`) : (node.layer === 'device' ? node : null);
    const entityNode = node.entity_id ? this.getNodeById(`entity-${node.entity_id}`) || this.getNodeById(`automation-${node.entity_id}`) || this.getNodeById(`scene-${node.entity_id}`) || this.getNodeById(`person-${node.entity_id}`) : (node.layer === 'entity' ? node : null);

    if (node.layer === 'area') {
      const devices = this.getRelatedNodes(node).filter((x) => x.layer === 'device').slice(0, 3);
      devices.forEach((dev) => {
        const entity = this.getRelatedNodes(dev).find((x) => x.layer === 'entity');
        const action = entity ? this.getRelatedNodes(entity).find((x) => x.layer === 'automation' || x.layer === 'scene') : null;
        paths.push([node, dev, entity, action].filter(Boolean));
      });
    } else if (node.layer === 'device') {
      const entity = this.getRelatedNodes(node).find((x) => x.layer === 'entity');
      const action = entity ? this.getRelatedNodes(entity).find((x) => x.layer === 'automation' || x.layer === 'scene') : null;
      paths.push([areaNode, node, entity, action].filter(Boolean));
    } else if (node.layer === 'entity') {
      const action = this.getRelatedNodes(node).find((x) => x.layer === 'automation' || x.layer === 'scene');
      paths.push([areaNode, deviceNode, node, action].filter(Boolean));
    } else if (node.layer === 'automation' || node.layer === 'scene') {
      const entity = this.getRelatedNodes(node).find((x) => x.layer === 'entity');
      const dev = entity?.device_id ? this.getNodeById(`device-${entity.device_id}`) : null;
      const area = entity?.area_id ? this.getNodeById(`area-${entity.area_id}`) : null;
      paths.push([area, dev, entity, node].filter(Boolean));
    } else if (node.layer === 'problem') {
      const dev = deviceNode || this.getNodeById(`device-${node.device_id}`);
      const entity = this.getRelatedNodes(node).find((x) => x.layer === 'entity');
      paths.push([areaNode, dev, entity, node].filter(Boolean));
    } else {
      paths.push([areaNode, deviceNode, entityNode, node].filter(Boolean));
    }

    const dedup = new Set();
    return paths.filter((path) => path.length >= 2).filter((path) => {
      const key = path.map((x) => x.id).join('>');
      if (dedup.has(key)) return false;
      dedup.add(key);
      return true;
    }).slice(0, 4);
  }

  updateFocusPaths() {
    if (!this.focusPathsEl) return;
    const item = this.selectedNode || this.hoveredNode;
    const paths = this.buildHierarchyPaths(item);
    this.focusPathsEl.innerHTML = '';
    if (!paths.length) {
      this.focusPathsEl.innerHTML = '<div class="empty">Ingen fokusväg tillgänglig för vald nod ännu.</div>';
      return;
    }
    paths.forEach((path) => {
      const row = document.createElement('div');
      row.className = 'path-row';
      path.forEach((node, idx) => {
        const button = document.createElement('button');
        button.className = 'path-node';
        button.textContent = node.title;
        button.addEventListener('click', () => this.selectNodeById(node.id));
        row.appendChild(button);
        if (idx < path.length - 1) {
          const arrow = document.createElement('span');
          arrow.className = 'path-arrow';
          arrow.textContent = '→';
          row.appendChild(arrow);
        }
      });
      this.focusPathsEl.appendChild(row);
    });
  }

  updateProblemList() {
    if (!this.problemListEl) return;
    const problems = this.data?.problem_devices || [];
    this.problemListEl.innerHTML = '';
    if (!problems.length) {
      this.problemListEl.innerHTML = '<div class="empty">Inga problem-enheter just nu.</div>';
      return;
    }
    problems.slice(0, 10).forEach((item) => {
      const button = document.createElement('button');
      button.className = 'row';
      button.innerHTML = `<strong>${this.escapeHtml(item.title)}</strong><small>${this.escapeHtml(item.meta || item.text || '')}</small>`;
      button.addEventListener('click', () => this.selectNodeById(item.id));
      this.problemListEl.appendChild(button);
    });
  }

  updateFocusLane() {
    if (!this.focusListEl) return;
    const items = this.visibleNodesSorted();
    const picks = [];
    const seen = new Set();
    [this.selectedNode, this.hoveredNode].forEach((node) => {
      if (node?.id && !seen.has(node.id) && this.nodeMap.get(node.id)?.visible) { picks.push(node); seen.add(node.id); }
    });
    items.forEach((node) => {
      if (picks.length >= 10 || seen.has(node.id)) return;
      picks.push(node); seen.add(node.id);
    });
    this.focusListEl.innerHTML = '';
    picks.forEach((item) => {
      const button = document.createElement('button');
      button.className = 'focus-row';
      button.innerHTML = `<strong>${this.escapeHtml(item.title)}</strong><small>${this.escapeHtml(item.meta || item.group || item.category || item.type)}</small>`;
      button.addEventListener('click', () => this.selectNodeById(item.id));
      this.focusListEl.appendChild(button);
    });
    this.updateFocusPaths();
  }

  updateStats() {
    const m = this.data?.meta || {};
    const visibleCount = this.visibleNodesSorted().length;
    this.statsEl.innerHTML = `
      <div class="stat"><div class="v">${m.integration_count || 0}</div><div class="k">Integrationer</div></div>
      <div class="stat"><div class="v">${m.area_count || 0}</div><div class="k">Areas</div></div>
      <div class="stat"><div class="v">${m.device_count || 0}</div><div class="k">Enheter</div></div>
      <div class="stat"><div class="v">${m.automation_count || 0}</div><div class="k">Automationer</div></div>
      <div class="stat"><div class="v">${m.scene_count || 0}</div><div class="k">Scener</div></div>
      <div class="stat"><div class="v">${visibleCount}</div><div class="k">Synliga noder</div></div>
      <div class="stat ${m.unavailable_count ? 'critical' : ''}"><div class="v">${m.unavailable_count || 0}</div><div class="k">Unavailable</div></div>
      <div class="stat ${m.problem_device_count ? 'critical' : ''}"><div class="v">${m.problem_device_count || 0}</div><div class="k">Problem-enheter</div></div>
      <div class="stat"><div class="v">${m.link_count || 0}</div><div class="k">Kopplingar</div></div>
    `;
  }

  updateSidePanel() {
    if (!this.data) return;
    this.updateStats();
    const item = this.selectedNode || this.hoveredNode;
    if (!item) return;
    const chips = [];
    if (item.layer && item.layer !== 'core') chips.push(item.layer);
    if (item.group) chips.push(item.group);
    if (item.category) chips.push(item.category);
    if (item.state) chips.push(`state ${item.state}`);
    if (item.use_count != null) chips.push(`count ${item.use_count}`);
    if (item.view_count != null) chips.push(`unavailable ${item.view_count}`);
    if (item.meta) chips.push(item.meta);
    this.detailsEl.innerHTML = `
      <div class="detail-type">${this.escapeHtml(item.layer || item.type || 'core')}</div>
      <h3>${this.escapeHtml(item.title)}</h3>
      <div class="detail-body">${this.escapeHtml(item.text || '')}</div>
      <div class="chips">${chips.map((chip) => `<span class="chip ${item.severity === 'critical' && String(chip).includes('unavailable') ? 'critical' : item.severity === 'warning' ? 'warning' : ''}">${this.escapeHtml(chip)}</span>`).join('')}</div>
    `;
    const related = this.getRelatedNodes(item);
    this.relationsEl.innerHTML = related.length ? '' : '<div class="empty">Ingen explicit koppling hittades för vald nod.</div>';
    related.forEach((rel) => {
      const button = document.createElement('button');
      button.className = 'relation-btn';
      button.innerHTML = `<strong>${this.escapeHtml(rel.title)}</strong><small>${this.escapeHtml(rel.relation)} · ${this.escapeHtml(rel.meta || rel.group || rel.layer || '')}</small>`;
      button.addEventListener('click', () => this.selectNodeById(rel.id));
      this.relationsEl.appendChild(button);
    });
    this.updateFocusPaths();
  }

  updateLabelAnchors() {
    if (!this.camera || !this.width || !this.height) return;
    const preferred = this.visibleNodesSorted();
    const chosenIds = new Set();
    if (this.labelMode !== 'off') {
      [this.selectedNode, this.hoveredNode].forEach((node) => node?.id && chosenIds.add(node.id));
      const max = this.labelMode === 'detailed' ? 18 : this.labelMode === 'normal' ? 10 : 5;
      preferred.forEach((node) => {
        if (chosenIds.size >= max) return;
        if (this.labelMode === 'detailed' || node.severity === 'critical' || (node.importance || 0) >= (this.labelMode === 'minimal' ? 0.9 : 0.82) || this.matchesSearch(node)) chosenIds.add(node.id);
      });
    }
    const occupied = [];
    this.labelEls.forEach((el, id) => {
      const mesh = this.nodeMap.get(id);
      if (!mesh?.visible || !chosenIds.has(id) || this.labelMode === 'off') { el.style.opacity = '0'; el.classList.remove('active'); return; }
      const screen = mesh.position.clone().project(this.camera);
      const inFront = screen.z > -1 && screen.z < 1;
      const inBounds = screen.x > -1.12 && screen.x < 1.12 && screen.y > -1.12 && screen.y < 1.12;
      if (!inFront || !inBounds) { el.style.opacity = '0'; el.classList.remove('active'); return; }
      const x = (screen.x * 0.5 + 0.5) * this.width;
      const y = (-screen.y * 0.5 + 0.5) * this.height - Math.max(26, mesh.scale.x * 2.6);
      const width = this.selectedNode?.id === id || this.hoveredNode?.id === id ? 210 : this.labelMode === 'detailed' ? 180 : this.labelMode === 'normal' ? 156 : 136;
      const height = 44;
      const rect = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
      const overlaps = occupied.some((box) => !(rect.right < box.left || rect.left > box.right || rect.bottom < box.top || rect.top > box.bottom));
      if (overlaps && this.selectedNode?.id !== id && this.hoveredNode?.id !== id) {
        el.style.opacity = '0';
        el.classList.remove('active');
        return;
      }
      occupied.push(rect);
      el.style.left = `${x}px`; el.style.top = `${y}px`;
      el.style.opacity = String(this.selectedNode?.id === id || this.hoveredNode?.id === id ? 1 : 0.86);
      if (this.selectedNode?.id === id || this.hoveredNode?.id === id) el.classList.add('active'); else el.classList.remove('active');
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
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.arc(w / 2, h / 2, i * 24, 0, Math.PI * 2); ctx.stroke(); }
    const viewPos = (node) => this.viewMode === 'timeline' ? node.timelinePosition : node.basePosition;
    this.visibleNodesSorted().forEach((node) => {
      const p = viewPos(node);
      const x = w / 2 + (p.x / 240) * 66;
      const y = h / 2 + (p.z / 240) * 66;
      ctx.beginPath();
      ctx.fillStyle = this.colorCss(node);
      ctx.globalAlpha = node.severity === 'critical' ? 1 : 0.86;
      ctx.arc(x, y, Math.max(2.1, node.size * 0.34), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    Object.entries(this.layerConfigs).forEach(([layer, cfg]) => {
      const center = this.viewMode === 'timeline' ? { x: cfg.band * 1.5, z: 0 } : { x: cfg.center.x, z: cfg.center.z };
      const x = w / 2 + (center.x / 240) * 66;
      const y = h / 2 + (center.z / 240) * 66;
      ctx.strokeStyle = `${cfg.css}55`;
      ctx.lineWidth = layer === 'problem' ? 2 : 1.2;
      ctx.beginPath(); ctx.arc(x, y, layer === 'problem' ? 17 : 13, 0, Math.PI * 2); ctx.stroke();
    });
    const focus = this.selectedNode || this.hoveredNode;
    if (focus?.id) {
      const p = viewPos(focus); const x = w / 2 + (p.x / 240) * 66; const y = h / 2 + (p.z / 240) * 66;
      ctx.beginPath(); ctx.fillStyle = '#ffffff'; ctx.arc(x, y, 4.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = focus.severity === 'critical' ? '#ff6b6b' : '#7ee7ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9.5, 0, Math.PI * 2); ctx.stroke();
    }
  }

  resize() {
    if (!this.sceneHost || !this.renderer || !this.camera) return;
    const rect = this.sceneHost.getBoundingClientRect();
    this.width = rect.width; this.height = rect.height;
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
    if (this.starfield) { this.starfield.rotation.y += 0.000012 * dt * (motionFactor || 0.2); this.starfield.rotation.x = Math.sin(t * 0.08) * 0.18; }
    this.rings?.forEach((ring, idx) => { ring.rotation.y += (0.00005 + idx * 0.000015) * dt * (motionFactor || 0.15); ring.rotation.z += (0.00003 + idx * 0.00001) * dt * (motionFactor || 0.1); });

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
      mesh.material.emissiveIntensity = active ? 1.4 : node.severity === 'critical' ? 1.18 : 0.72;
      mesh.material.opacity = active ? 1 : Math.min(0.98, node.alpha);
      if (mesh.userData.halo) mesh.userData.halo.material.opacity = active ? 0.2 : (node.severity === 'critical' ? 0.18 : 0.08);
    }

    const focusMesh = this.nodeMap.get(this.selectedNode?.id || this.hoveredNode?.id);
    if (focusMesh) {
      const pulse = 1.55 + Math.sin(t * 2.8) * 0.12;
      this.selectionAura.visible = true;
      this.selectionAura.position.copy(focusMesh.position);
      this.selectionAura.scale.setScalar(focusMesh.scale.x * pulse);
      this.selectionAura.material.color.set(this.colorFor(focusMesh.userData.node));
      this.selectionAura.material.opacity = this.selectedNode ? 0.18 : 0.1;
    } else this.selectionAura.visible = false;

    if (this.lines?.geometry && this.linkPairs?.length) {
      const pos = this.lines.geometry.attributes.position.array;
      let k = 0;
      this.linkPairs.forEach(({ a, b }, idx) => {
        const active = this.selectedNode?.id && (a.userData.node.id === this.selectedNode.id || b.userData.node.id === this.selectedNode.id);
        pos[k++] = a.position.x; pos[k++] = a.position.y; pos[k++] = a.position.z;
        pos[k++] = b.position.x; pos[k++] = b.position.y; pos[k++] = b.position.z;
        if (positions && idx < this.pulseCount) {
          this.pulseProgress[idx] = (this.pulseProgress[idx] + dt * 0.00035 * this.pulseSpeeds[idx]) % 1;
          const p = this.pulseProgress[idx];
          positions[idx * 3] = a.position.x + (b.position.x - a.position.x) * p;
          positions[idx * 3 + 1] = a.position.y + (b.position.y - a.position.y) * p;
          positions[idx * 3 + 2] = a.position.z + (b.position.z - a.position.z) * p;
        }
        if (active && this.lines.material) this.lines.material.opacity = 0.38;
      });
      this.lines.geometry.attributes.position.needsUpdate = true;
      if (this.pulsePoints.geometry.attributes.position) this.pulsePoints.geometry.attributes.position.needsUpdate = true;
      if (!this.selectedNode && this.lines.material) this.lines.material.opacity = 0.18;
    }

    this.updateLabelAnchors();
    this.drawMiniMap();
    this.controls?.update();
    this.renderer?.render(this.scene, this.camera);
    this.raf = requestAnimationFrame((next) => this.animate(next));
  }
}

customElements.define('hermes-ha-cloud-panel', HermesHACloudPanel);
