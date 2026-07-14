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
    this.effects = { orbitRings: true, nebulas: true, relationTraffic: true, autoZoom: true, cinematicGlow: true };
    this.windowPreset = 'overview';
    this.presetProfile = 'galaxy';
    this.settingsCollapsed = false;
    this.drawerOpen = false;
    this.mobileChromeHidden = false;
    this.mobileControlsCollapsed = false;
    this.mobileMiniMapVisible = false;
    this.mobileTab = 'cloud';
    this.sidebarView = 'rooms';
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
    this.loadPreferences();
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
    this.sceneWrapEl = this.shadowRoot.querySelector('.scene-wrap');
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
    this.mobileTabsEl = this.shadowRoot.getElementById('mobiletabs');
    this.mobileCloudActionsEl = this.shadowRoot.getElementById('mobile-cloud-actions');
    this.mobileBottomNavEl = this.shadowRoot.getElementById('mobile-bottom-nav');
    this.desktopHeaderTabsEl = this.shadowRoot.getElementById('desktop-header-tabs');
    this.sidebarTabsDesktopEl = this.shadowRoot.getElementById('sidebartabs');
    this.sidebarRoomsEl = this.shadowRoot.getElementById('sidebar-rooms');
    this.sidebarDevicesEl = this.shadowRoot.getElementById('sidebar-devices');
    this.sidebarProblemsEl = this.shadowRoot.getElementById('sidebar-problems');
    this.mobileControlsToggleEl = this.shadowRoot.getElementById('mobile-controls-toggle');
    this.mobileMiniMapToggleEl = this.shadowRoot.getElementById('mobile-minimap-toggle');
    this.mobileControlsBodyEl = this.shadowRoot.getElementById('mobile-controls-body');
    this.minimapWrapEl = this.shadowRoot.getElementById('minimap-wrap');
    this.labelModeEl = this.shadowRoot.getElementById('labelmodes');
    this.motionModeEl = this.shadowRoot.getElementById('motionmodes');
    this.viewModeEl = this.shadowRoot.getElementById('viewmodes');
    this.effectsEl = this.shadowRoot.getElementById('effects');
    this.windowPresetsEl = this.shadowRoot.getElementById('windowpresets');
    this.presetProfilesEl = this.shadowRoot.getElementById('presetprofiles');
    this.settingsToggleEl = this.shadowRoot.getElementById('settings-toggle');
    this.settingsBodyEl = this.shadowRoot.getElementById('settings-body');
    this.drawerToggleEl = this.shadowRoot.getElementById('drawer-toggle');
    this.drawerCloseEl = this.shadowRoot.getElementById('drawer-close');
    this.drawerOverlayEl = this.shadowRoot.getElementById('drawer-overlay');
    this.drawerShellEl = this.shadowRoot.getElementById('controls-drawer');
    this.panelAsideEl = this.shadowRoot.querySelector('aside');
    this.inspectorShellEl = this.shadowRoot.getElementById('inspector-shell');
    this.inspectorTitleEl = this.shadowRoot.getElementById('inspector-title');
    this.inspectorTypeEl = this.shadowRoot.getElementById('inspector-type');
    this.inspectorBodyEl = this.shadowRoot.getElementById('inspector-body');
    this.inspectorMetaEl = this.shadowRoot.getElementById('inspector-meta');
    this.inspectorRelationsEl = this.shadowRoot.getElementById('inspector-relations');
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

  makeGlowTexture({ core = 'rgba(255,255,255,1)', mid = 'rgba(150,210,255,0.34)', edge = 'rgba(120,180,255,0)' } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, core);
    grad.addColorStop(0.22, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.5, mid);
    grad.addColorStop(1, edge);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  makeLensFlareGroup(color) {
    const group = new THREE.Group();
    const flareTexture = this.flareTexture || this.makeGlowTexture();
    const makeSprite = (scale, opacity, offsetX, offsetY) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flareTexture,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
      sprite.scale.set(scale, scale, 1);
      sprite.position.set(offsetX, offsetY, 0);
      group.add(sprite);
      return sprite;
    };
    makeSprite(2.8, 0.18, 0, 0);
    makeSprite(1.2, 0.11, 0.7, 0.25);
    makeSprite(0.75, 0.08, -0.55, -0.35);
    return group;
  }

  loadPreferences() {
    try {
      const raw = window.localStorage?.getItem('hermes-ha-cloud-ui');
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (prefs.viewMode) this.viewMode = prefs.viewMode;
      if (prefs.labelMode) this.labelMode = prefs.labelMode;
      if (prefs.motionMode) this.motionMode = prefs.motionMode;
      if (prefs.windowPreset) this.windowPreset = prefs.windowPreset;
      if (prefs.presetProfile) this.presetProfile = prefs.presetProfile;
      if (typeof prefs.settingsCollapsed === 'boolean') this.settingsCollapsed = prefs.settingsCollapsed;
      if (typeof prefs.drawerOpen === 'boolean') this.drawerOpen = prefs.drawerOpen;
      if (typeof prefs.mobileChromeHidden === 'boolean') this.mobileChromeHidden = prefs.mobileChromeHidden;
      if (prefs.sidebarView) this.sidebarView = prefs.sidebarView;
      if (!['rooms', 'devices', 'problems', 'types'].includes(this.sidebarView)) this.sidebarView = 'rooms';
      if (prefs.effects && typeof prefs.effects === 'object') this.effects = { ...this.effects, ...prefs.effects };
      this.autoDrift = this.motionMode === 'live' ? 0.0001 : this.motionMode === 'still' ? 0 : 0.00004;
    } catch {}
  }

  savePreferences() {
    try {
      window.localStorage?.setItem('hermes-ha-cloud-ui', JSON.stringify({
        viewMode: this.viewMode,
        labelMode: this.labelMode,
        motionMode: this.motionMode,
        effects: this.effects,
        windowPreset: this.windowPreset,
        presetProfile: this.presetProfile,
        settingsCollapsed: this.settingsCollapsed,
        drawerOpen: this.drawerOpen,
        mobileChromeHidden: this.mobileChromeHidden,
        sidebarView: this.sidebarView,
      }));
    } catch {}
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
          grid-template-columns: 248px minmax(0, 1fr);
          min-height: 100vh;
          min-height: 100dvh;
          height: 100vh;
          height: 100dvh;
          background:
            radial-gradient(circle at 18% 14%, rgba(58, 126, 255, 0.16), transparent 26%),
            radial-gradient(circle at 74% 20%, rgba(150, 88, 255, 0.14), transparent 24%),
            radial-gradient(circle at 54% 84%, rgba(56, 220, 187, 0.11), transparent 24%),
            linear-gradient(180deg, var(--bg1), var(--bg0));
        }
        .scene-wrap { position: relative; overflow: hidden; border-left: 1px solid var(--border); }
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
        .hud { position: absolute; inset: 84px auto auto 16px; width: min(920px, calc(100% - 64px)); margin: 0; pointer-events: none; z-index: 4; }
        .desktop-header {
          position: absolute;
          top: 16px;
          left: 16px;
          right: 16px;
          z-index: 6;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 12px;
          border: 1px solid rgba(130, 175, 255, 0.12);
          border-radius: 14px;
          background: rgba(8, 13, 26, 0.62);
          backdrop-filter: blur(16px);
          box-shadow: 0 10px 30px rgba(0,0,0,0.24);
        }
        .desktop-header-left,
        .desktop-header-right,
        .desktop-header-center {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .desktop-header-center { justify-content: center; flex: 1; }
        .desktop-header button {
          border: 1px solid rgba(140, 180, 255, 0.14);
          background: transparent;
          color: #94a3c7;
          padding: 8px 12px;
          border-radius: 10px;
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 600;
        }
        .desktop-header button.active {
          background: rgba(249, 115, 22, 0.14);
          color: #f8fafc;
          border-color: rgba(249, 115, 22, 0.34);
          box-shadow: 0 0 12px rgba(249,115,22,0.12);
        }
        .headline { pointer-events: auto; background: linear-gradient(180deg, rgba(9,14,31,0.84), rgba(9,14,31,0.48)); border: 1px solid var(--border); border-radius: 18px; padding: 18px 20px; box-shadow: 0 14px 42px rgba(0,0,0,0.24); }
        .drawer-launch { margin-top: 12px; display: flex; gap: 10px; align-items: center; pointer-events: auto; }
        .drawer-toggle, .drawer-close {
          border: 1px solid rgba(140, 180, 255, 0.18); background: rgba(11, 18, 34, 0.88); color: #eef4ff;
          padding: 10px 14px; border-radius: 14px; cursor: pointer; font: inherit;
          box-shadow: 0 10px 24px rgba(0,0,0,0.2);
        }
        .drawer-hint { color: #9ab0da; font-size: 12px; }
        .drawer-overlay {
          position: absolute; inset: 0; background: rgba(2, 5, 12, 0.52); backdrop-filter: blur(6px);
          opacity: 0; pointer-events: none; transition: opacity 180ms ease; z-index: 6;
        }
        .drawer-overlay.open { opacity: 1; pointer-events: auto; }
        .controls-drawer {
          position: absolute; top: 16px; left: 16px; bottom: 16px; width: min(430px, calc(100% - 32px));
          border: 1px solid rgba(130, 175, 255, 0.16); border-radius: 20px;
          background: linear-gradient(180deg, rgba(7,12,24,0.96), rgba(5,9,18,0.96));
          box-shadow: 0 26px 70px rgba(0,0,0,0.4); z-index: 7; overflow: auto;
          transform: translateX(-112%); opacity: 0; pointer-events: none; transition: transform 180ms ease, opacity 180ms ease;
        }
        .controls-drawer.open { transform: translateX(0); opacity: 1; pointer-events: auto; }
        .drawer-head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; background: rgba(9, 15, 28, 0.94); border-bottom: 1px solid rgba(130,175,255,0.12); }
        .drawer-head strong { font-size: 14px; }
        .drawer-head small { color: #98aed8; display: block; margin-top: 3px; }
        .drawer-body { padding: 14px 16px 18px; }
        .mobile-toolbar, .mobile-tabs { display: none; }
        .mobile-cloud-actions {
          display: none;
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 76px;
          z-index: 5;
          gap: 8px;
          justify-content: center;
          pointer-events: auto;
          transition: opacity 180ms ease, transform 180ms ease;
        }
        .mobile-bottom-nav {
          display: none;
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 12px;
          z-index: 6;
          gap: 8px;
          justify-content: space-between;
          padding: 8px;
          border: 1px solid rgba(140, 180, 255, 0.16);
          border-radius: 18px;
          background: rgba(7, 12, 24, 0.84);
          backdrop-filter: blur(16px);
          box-shadow: 0 18px 42px rgba(0,0,0,0.28);
          transition: opacity 180ms ease, transform 180ms ease;
        }
        .mobile-bottom-nav button {
          flex: 1 1 0;
          border: 1px solid rgba(140, 180, 255, 0.16);
          background: rgba(14, 21, 42, 0.84);
          color: #eef4ff;
          padding: 10px 8px;
          border-radius: 14px;
          cursor: pointer;
          font: inherit;
        }
        .mobile-bottom-nav button.active {
          background: rgba(36, 75, 164, 0.95);
          border-color: rgba(125, 215, 255, 0.34);
        }
        .mobile-cloud-actions button {
          border: 1px solid rgba(140, 180, 255, 0.18); background: rgba(9, 15, 28, 0.84); color: #eef4ff;
          padding: 9px 12px; border-radius: 999px; cursor: pointer; font: inherit; backdrop-filter: blur(12px);
          box-shadow: 0 12px 30px rgba(0,0,0,0.24);
        }
        .mobile-cloud-actions button.active,
        .mobile-cloud-actions.active-cloud button[data-cloud-action="drawer"] {
          background: rgba(36, 75, 164, 0.95);
          border-color: rgba(125, 215, 255, 0.34);
        }
        .mobile-toolbar { margin-top: 12px; gap: 8px; }
        .mobile-controls-body.collapsed { display: none; }
        .mobile-toolbar button, .mobile-tabs button {
          border: 1px solid rgba(140, 180, 255, 0.16); background: rgba(14, 21, 42, 0.84); color: #eef4ff;
          padding: 9px 12px; border-radius: 999px; cursor: pointer; transition: 140ms ease; font: inherit;
        }
        .mobile-toolbar button.active, .mobile-tabs button.active { background: rgba(36, 75, 164, 0.95); border-color: rgba(125, 215, 255, 0.34); }
        .eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; color: #82b5ff; margin-bottom: 6px; }
        h1 { margin: 0; font-size: 30px; line-height: 1.1; }
        .sub { margin-top: 8px; max-width: 760px; color: #b0c0e8; font-size: 14px; line-height: 1.55; }
        .controls {
          grid-template-columns: minmax(180px, 1.3fr) repeat(3, auto);
          gap: 12px;
          margin-top: 14px;
          align-items: center;
        }
        .controls-extended { margin-top: 12px; }
        .search input { width: 100%; border-radius: 999px; border: 1px solid var(--border); background: rgba(5, 9, 20, 0.9); color: #eef4ff; padding: 11px 14px; outline: none; }
        .search input::placeholder { color: #8294bf; }
        .control-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .control-stack { display: grid; gap: 10px; margin-top: 12px; }
        .settings-shell { margin-top: 12px; border: 1px solid rgba(140, 180, 255, 0.12); border-radius: 16px; background: rgba(7, 12, 24, 0.44); overflow: hidden; }
        .settings-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 0; background: rgba(11, 18, 34, 0.82); color: #eef4ff; cursor: pointer; font: inherit; text-align: left; }
        .settings-toggle strong { font-size: 13px; }
        .settings-toggle small { color: #94aad6; }
        .settings-toggle .chev { transition: transform 140ms ease; }
        .settings-shell.collapsed .settings-toggle .chev { transform: rotate(-90deg); }
        .settings-body { padding: 12px 14px 14px; }
        .settings-shell.collapsed .settings-body { display: none; }
        .control-section { display: grid; gap: 8px; }
        .control-section-title { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #8eaee6; }
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
        .inspector-shell {
          position: absolute;
          top: 84px;
          right: 16px;
          width: min(360px, calc(100% - 32px));
          max-height: calc(100% - 156px);
          overflow: auto;
          z-index: 6;
          border: 1px solid rgba(148, 163, 184, 0.14);
          border-radius: 18px;
          background: rgba(2, 6, 23, 0.68);
          backdrop-filter: blur(18px);
          box-shadow: 0 18px 48px rgba(0,0,0,0.34);
          padding: 14px;
        }
        .inspector-head {
          display: grid;
          gap: 6px;
          padding-bottom: 12px;
          margin-bottom: 12px;
          border-bottom: 1px solid rgba(148,163,184,0.1);
        }
        .inspector-kicker {
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-size: 10px;
          color: #89aef5;
        }
        .inspector-title {
          font-size: 20px;
          font-weight: 800;
          color: #f8fafc;
          line-height: 1.15;
        }
        .inspector-body {
          color: #d7e5ff;
          line-height: 1.55;
          font-size: 13px;
        }
        .inspector-meta, .inspector-relations {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }
        .inspector-section-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #8eaee6;
        }
        .inspector-pill-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .inspector-pill {
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid rgba(140,180,255,0.14);
          background: rgba(14,21,42,0.84);
          color: #eef4ff;
          font-size: 12px;
        }
        .inspector-rel-btn {
          border: 1px solid rgba(140,180,255,0.14);
          background: rgba(14,21,42,0.84);
          color: #eef4ff;
          padding: 10px 12px;
          border-radius: 14px;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }
        .inspector-rel-btn small { display: block; color: #95a8d7; margin-top: 3px; }
        canvas#minimap { width: 180px; height: 180px; display: block; border-radius: 18px; background: radial-gradient(circle at 50% 50%, rgba(21, 31, 58, 0.85), rgba(6, 10, 23, 0.96)); border: 1px solid rgba(146, 186, 255, 0.12); box-shadow: 0 16px 34px rgba(0, 0, 0, 0.28); }
        .minimap-copy { margin-top: 8px; text-align: center; font-size: 11px; color: #90a5d6; }
        aside {
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: rgba(2, 6, 23, 0.4);
          backdrop-filter: blur(16px);
          border-right: 1px solid rgba(148, 163, 184, 0.12);
          padding: 0;
          gap: 0;
        }
        .sidebar-brand {
          height: 64px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 0 20px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }
        .sidebar-brand .sidebar-title {
          font-size: 21px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #f8fafc;
        }
        .sidebar-brand .sidebar-subtitle {
          font-size: 10px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-top: -2px;
        }
        .sidebar-tabs-desktop {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          padding: 8px;
          gap: 6px;
          background: rgba(0,0,0,0.18);
          border-bottom: 1px solid rgba(148, 163, 184, 0.08);
        }
        .sidebar-tabs-desktop button {
          flex: 1;
          border: 0;
          background: transparent;
          color: #94a3b8;
          padding: 8px;
          border-radius: 8px;
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .sidebar-tabs-desktop button.active {
          background: rgba(8, 13, 26, 0.8);
          color: #f8fafc;
          box-shadow: 0 0 12px rgba(125,215,255,0.08);
        }
        .sidebar-body {
          flex: 1;
          overflow: auto;
          display: grid;
          gap: 10px;
          padding: 12px;
        }
        .sidebar-section-card { display: none; }
        aside[data-sidebar-view="rooms"] .sidebar-section-card[data-sidebar-section="rooms"],
        aside[data-sidebar-view="devices"] .sidebar-section-card[data-sidebar-section="devices"],
        aside[data-sidebar-view="problems"] .sidebar-section-card[data-sidebar-section="problems"],
        aside[data-sidebar-view="types"] .sidebar-section-card[data-sidebar-section="types"] { display: block; }
        .sidebar-footer {
          padding: 10px 14px 14px;
          border-top: 1px solid rgba(148, 163, 184, 0.08);
          color: #94a3b8;
          font-size: 11px;
        }
        aside[data-window-preset="overview"] .card[data-panel] { display: block; }
        aside[data-window-preset="relations"] .card[data-panel]:not([data-panel="relations"]) { display: none; }
        aside[data-window-preset="focus"] .card[data-panel]:not([data-panel="focus"]) { display: none; }
        aside[data-window-preset="problem"] .card[data-panel]:not([data-panel="problem"]) { display: none; }
        aside[data-window-preset="snapshot"] .card[data-panel]:not([data-panel="snapshot"]) { display: none; }
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
          .layout { grid-template-columns: 1fr; grid-template-rows: minmax(62vh, 68vh) auto; }
          .scene-wrap { border-right: 0; border-bottom: 1px solid var(--border); }
        }
        @media (max-width: 720px) {
          .layout { min-height: 100dvh; height: auto; grid-template-rows: minmax(72dvh, 82dvh) auto; }
          .scene-wrap {
            border-right: 0;
            border-bottom: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            min-height: min(82dvh, 900px);
            overflow: clip;
          }
          .hud {
            position: relative;
            inset: auto;
            width: auto;
            margin: 8px;
          }
          .headline {
            padding: 10px 12px;
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(9,14,31,0.76), rgba(9,14,31,0.34));
            backdrop-filter: blur(10px);
          }
          .drawer-launch {
            margin-top: 10px;
            gap: 8px;
            align-items: center;
          }
          .drawer-launch .drawer-hint {
            display: none;
          }
          .drawer-toggle {
            width: 100%;
            justify-content: center;
            text-align: center;
          }
          .mobile-toolbar,
          .mobile-tabs,
          .mobile-cloud-actions,
          .mobile-bottom-nav {
            display: flex;
            flex-wrap: nowrap;
            overflow-x: auto;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
          }
          .mobile-toolbar::-webkit-scrollbar,
          .mobile-tabs::-webkit-scrollbar { display: none; }
          .controls-drawer {
            top: 10px;
            left: 10px;
            right: 10px;
            bottom: 10px;
            width: auto;
            max-width: none;
            border-radius: 18px;
          }
          .drawer-body {
            padding: 12px 12px 16px;
          }
          .eyebrow {
            font-size: 10px;
            letter-spacing: 0.12em;
            margin-bottom: 4px;
          }
          h1 {
            font-size: 20px;
            line-height: 1.05;
          }
          .sub {
            font-size: 12px;
            line-height: 1.32;
            max-width: none;
          }
          .controls {
            grid-template-columns: 1fr;
            gap: 10px;
          }
          .search input {
            padding: 10px 12px;
            font-size: 16px;
          }
          .control-group,
          .filters,
          .legend {
            display: flex;
            flex-wrap: nowrap;
            overflow-x: auto;
            overflow-y: hidden;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            padding-bottom: 4px;
          }
          .control-group::-webkit-scrollbar,
          .filters::-webkit-scrollbar,
          .legend::-webkit-scrollbar {
            display: none;
          }
          .control-pills button,
          .filters button,
          .row,
          .focus-row,
          .relation-btn,
          .path-node {
            flex: 0 0 auto;
          }
          .legend {
            margin-top: 10px;
          }
          .minimap-wrap {
            position: relative;
            right: auto;
            bottom: auto;
            transform: none;
            margin: 0 auto 12px;
            z-index: 4;
          }
          .minimap-wrap.hidden-mobile {
            display: none;
          }
          canvas#minimap {
            width: 148px;
            height: 148px;
          }
          .minimap-copy {
            font-size: 10px;
          }
          .desktop-header,
          .sidebar-brand,
          .sidebar-tabs-desktop,
          .sidebar-footer,
          .sidebar-section-card,
          .inspector-shell {
            display: none;
          }
          aside {
            background: linear-gradient(180deg, rgba(4,7,16,0.55), rgba(4,7,16,0.92));
            border-right: 0;
          }
          .sidebar-body {
            padding: 8px 10px 12px;
            gap: 8px;
          }
          .mobile-tabs {
            position: sticky;
            top: 0;
            z-index: 2;
            padding: 2px 0 4px;
            margin-bottom: 2px;
            gap: 8px;
            background: linear-gradient(180deg, rgba(4,7,16,0.96), rgba(4,7,16,0.72));
            backdrop-filter: blur(10px);
          }
          .scene-wrap[data-mobile-mode="cloud"] .hud {
            inset: 8px auto auto 8px;
            width: calc(100% - 16px);
            margin-top: 6px;
            transition: opacity 180ms ease, transform 180ms ease;
          }
          .scene-wrap[data-mobile-mode="cloud"] .headline {
            padding: 8px 10px;
            background: linear-gradient(180deg, rgba(9,14,31,0.58), rgba(9,14,31,0.14));
            transition: opacity 180ms ease, transform 180ms ease;
          }
          .scene-wrap[data-mobile-mode="cloud"] .sub,
          .scene-wrap[data-mobile-mode="cloud"] .drawer-launch .drawer-hint {
            display: none;
          }
          .scene-wrap[data-mobile-mode="cloud"] .mobile-toolbar {
            margin-top: 8px;
            transition: opacity 180ms ease, transform 180ms ease;
          }
          .scene-wrap[data-mobile-mode="cloud"][data-mobile-chrome="hidden"] .hud,
          .scene-wrap[data-mobile-mode="cloud"][data-mobile-chrome="hidden"] .mobile-tabs,
          .scene-wrap[data-mobile-mode="cloud"][data-mobile-chrome="hidden"] .mobile-cloud-actions,
          .scene-wrap[data-mobile-mode="cloud"][data-mobile-chrome="hidden"] .mobile-bottom-nav {
            opacity: 0;
            transform: translateY(10px);
            pointer-events: none;
          }
          aside[data-mobile-tab="cloud"] {
            padding-top: 0;
            padding-bottom: 6px;
            gap: 4px;
            background: transparent;
          }
          aside[data-mobile-tab="cloud"] .card[data-panel] {
            display: none;
          }
          aside .card[data-panel] {
            display: none;
          }
          aside[data-mobile-tab="snapshot"] .card[data-panel="snapshot"],
          aside[data-mobile-tab="relations"] .card[data-panel="relations"],
          aside[data-mobile-tab="focus"] .card[data-panel="focus"],
          aside[data-mobile-tab="problem"] .card[data-panel="problem"] {
            display: block;
          }
          .card {
            padding: 12px;
            border-radius: 14px;
          }
          .stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .stat {
            padding: 10px;
          }
          .stat .v {
            font-size: 20px;
          }
          .path-row {
            padding: 8px;
          }
        }
        @media (max-width: 480px) {
          .hud { inset: 8px auto auto 8px; width: calc(100% - 16px); margin: 0; }
          .headline { padding: 12px; }
          h1 { font-size: 20px; }
          .sub { font-size: 12px; }
          .control-pills button,
          .filters button {
            padding: 8px 10px;
            font-size: 13px;
          }
          canvas#minimap {
            width: 132px;
            height: 132px;
          }
          .stats {
            grid-template-columns: 1fr 1fr;
          }
        }
      </style>
      <div class="layout">
        <aside data-sidebar-view="${this.sidebarView}">
          <div class="sidebar-brand">
            <div class="sidebar-title">Hermes HA Cloud</div>
            <div class="sidebar-subtitle">home assistant observatory</div>
          </div>
          <div class="sidebar-tabs-desktop" id="sidebartabs">
            <button type="button" data-sidebar-view="rooms">Rooms</button>
            <button type="button" data-sidebar-view="devices">Devices</button>
            <button type="button" data-sidebar-view="problems">Problems</button>
            <button type="button" data-sidebar-view="types">Node Types</button>
          </div>
          <div class="sidebar-body">
            <div class="mobile-tabs" id="mobiletabs">
              <button type="button" data-tab="cloud">Moln</button>
              <button type="button" data-tab="snapshot">Snapshot</button>
              <button type="button" data-tab="relations">Kopplingar</button>
              <button type="button" data-tab="focus">Fokus</button>
              <button type="button" data-tab="problem">Problem</button>
            </div>
            <div class="card sidebar-section-card" data-sidebar-section="rooms">
              <h3>Rooms</h3>
              <div class="microcopy">Snabbval för områden/system, inspirerat av ArcRift's vänsterpanel.</div>
              <div class="list" id="sidebar-rooms"></div>
            </div>
            <div class="card sidebar-section-card" data-sidebar-section="devices">
              <h3>Devices</h3>
              <div class="microcopy">Viktigaste enheterna just nu, prioriterat efter synlighet och vikt.</div>
              <div class="list" id="sidebar-devices"></div>
            </div>
            <div class="card sidebar-section-card" data-sidebar-section="problems">
              <h3>Problems</h3>
              <div class="microcopy">Problemfokuserad lista med unavailable/unknown-fall och kritiska noder.</div>
              <div class="list" id="sidebar-problems"></div>
            </div>
            <div class="card sidebar-section-card" data-sidebar-section="types">
              <h3>Node types</h3>
              <div class="microcopy">ArcRift-inspirerad legendvy för att snabbt förstå lagren i HA-kartan.</div>
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
            <div class="card" data-panel="snapshot">
              <h2>Live snapshot</h2>
              <div class="stats" id="stats"></div>
            </div>
            <div class="card" id="details" data-panel="snapshot"></div>
            <div class="card" data-panel="relations">
              <h3>Kopplingar</h3>
              <div class="microcopy">Direkta relationer till vald nod: vilka saker den tillhör, styr, påverkar eller ligger i samma area som.</div>
              <div class="relations" id="relations"></div>
            </div>
            <div class="card" data-panel="focus">
              <h3>Focus lane</h3>
              <div class="microcopy">Viktigaste synliga noderna just nu. Problem och unavailable får extra vikt.</div>
              <div class="focus-grid" id="focuslist"></div>
            </div>
            <div class="card" data-panel="focus">
              <h3>Fokusvägar</h3>
              <div class="microcopy">Klickbara kedjor mellan rum, enhet, entitet och automation/scen för vald nod.</div>
              <div class="focus-paths" id="focuspaths"></div>
            </div>
            <div class="card" data-panel="problem">
              <h3>Problem-enheter</h3>
              <div class="microcopy">Enheter med unavailable- eller unknown-tyngd. Klicka för att följa kopplingarna.</div>
              <div class="list" id="problemlist"></div>
            </div>
            <div class="card sidebar-legend-card">
              <h3>Node types</h3>
              <div class="microcopy">ArcRift-inspirerad legendvy för att snabbt förstå lagren i HA-kartan.</div>
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
          <div class="sidebar-footer">Local-first HA-graf med ArcRift-inspirerad uppställning, menyer och glassmorphism-krom.</div>
        </aside>
        <div class="scene-wrap">
          <div id="scene"></div>
          <div class="grid-glow"></div>
          <div class="labels" id="labels"></div>
          <div class="tooltip" id="tooltip"></div>
          <div class="drawer-overlay${this.drawerOpen ? ' open' : ''}" id="drawer-overlay"></div>
          <div class="mobile-cloud-actions" id="mobile-cloud-actions">
            <button type="button" data-cloud-action="snapshot">📸 Snapshot</button>
            <button type="button" data-cloud-action="problem">⚠️ Problem</button>
            <button type="button" data-cloud-action="drawer">☰ Meny</button>
          </div>
          <div class="mobile-bottom-nav" id="mobile-bottom-nav">
            <button type="button" data-bottom-tab="cloud">☁️ Moln</button>
            <button type="button" data-bottom-tab="snapshot">📸 Snapshot</button>
            <button type="button" data-bottom-tab="problem">⚠️ Problem</button>
            <button type="button" data-bottom-tab="drawer">☰ Meny</button>
          </div>
          <div class="controls-drawer${this.drawerOpen ? ' open' : ''}" id="controls-drawer">
            <div class="drawer-head">
              <span><strong>🧭 Kontrollpanel</strong><small>App-lik drawer för vyer, profiler och effekter</small></span>
              <button class="drawer-close" id="drawer-close" type="button">Stäng</button>
            </div>
            <div class="drawer-body">
              <div class="controls">
                <label class="search"><input id="search" type="search" placeholder="Sök rum, enheter, integrationer, automations, personer..." /></label>
                <div class="control-group control-pills" id="viewmodes"></div>
                <div class="control-group control-pills" id="labelmodes"></div>
                <div class="control-group control-pills" id="motionmodes"></div>
              </div>
              <div class="settings-shell${this.settingsCollapsed ? ' collapsed' : ''}" id="settings-shell">
                <button class="settings-toggle" id="settings-toggle" type="button">
                  <span>
                    <strong>⚙️ Inställningar & presets</strong><br />
                    <small>Effekter, profiler och fönster för panelen</small>
                  </span>
                  <span class="chev">▾</span>
                </button>
                <div class="settings-body" id="settings-body">
                  <div class="control-stack controls-extended">
                    <div class="control-section">
                      <div class="control-section-title">Profil</div>
                      <div class="control-group control-pills" id="presetprofiles"></div>
                    </div>
                    <div class="control-section">
                      <div class="control-section-title">Effekter</div>
                      <div class="control-group control-pills" id="effects"></div>
                    </div>
                    <div class="control-section">
                      <div class="control-section-title">Fönster</div>
                      <div class="control-group control-pills" id="windowpresets"></div>
                    </div>
                  </div>
                </div>
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
          <div class="vignette"></div>
          <div class="cinema-bar top"></div>
          <div class="cinema-bar bottom"></div>
          <div class="desktop-header">
            <div class="desktop-header-left">
              <button type="button" data-window-target="drawer">Load Session</button>
            </div>
            <div class="desktop-header-center" id="desktop-header-tabs">
              <button type="button" data-window-target="overview">Knowledge Graph</button>
              <button type="button" data-window-target="snapshot">Snapshot</button>
              <button type="button" data-window-target="relations">Facts</button>
              <button type="button" data-window-target="focus">Chat</button>
              <button type="button" data-window-target="problem">Problems</button>
            </div>
            <div class="desktop-header-right">
              <button type="button" data-window-target="drawer">Settings</button>
            </div>
          </div>
          <div class="hud">
            <div class="headline">
              <div class="eyebrow">Home Assistant / topology observatory</div>
              <h1>Hermes HA Cloud</h1>
              <div class="sub">HA-specifik molnkarta där fokus ligger på aktiva och fungerande delar först. Problem, unavailable och trasiga delar finns kvar men filtreras in separat. Objekt är hårdare separerade för bättre läsbarhet och tydligare relationer.</div>
              <div class="drawer-launch">
                <button class="drawer-toggle" id="drawer-toggle" type="button">☰ Kontrollpanel</button>
                <span class="drawer-hint">Öppna vyer, presets och effekter i en sidomeny</span>
              </div>
              <div class="mobile-toolbar">
                <button id="mobile-controls-toggle" type="button">Drawer</button>
                <button id="mobile-minimap-toggle" type="button">Karta</button>
              </div>
              <div class="mobile-controls-body" id="mobile-controls-body"></div>
            </div>
          </div>
          <div class="inspector-shell" id="inspector-shell">
            <div class="inspector-head">
              <div class="inspector-kicker" id="inspector-type">Inspector</div>
              <div class="inspector-title" id="inspector-title">Hermes HA Cloud</div>
            </div>
            <div class="inspector-body" id="inspector-body">Välj en nod i grafen för att se metadata, relationer och fokusvägar utan att lämna molnvyn.</div>
            <div class="inspector-meta" id="inspector-meta"></div>
            <div class="inspector-relations" id="inspector-relations"></div>
          </div>
          <div class="minimap-wrap" id="minimap-wrap">
            <canvas id="minimap" width="180" height="180"></canvas>
            <div class="minimap-copy">Layer map / live focus radar</div>
          </div>
        </div>
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
    this.flareTexture = this.makeGlowTexture();
    this.softGlowTexture = this.makeGlowTexture({ core: 'rgba(255,255,255,0.92)', mid: 'rgba(132,196,255,0.18)', edge: 'rgba(120,180,255,0)' });
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
    this.coreGlow = new THREE.Mesh(new THREE.SphereGeometry(13, 32, 32), new THREE.MeshPhysicalMaterial({ color: 0x8fe8ff, emissive: 0x8fe8ff, emissiveIntensity: 1.8, roughness: 0.16, metalness: 0.02 }));
    this.scene.add(this.coreGlow);
    this.coreShell = new THREE.Mesh(new THREE.SphereGeometry(24, 32, 32), new THREE.MeshBasicMaterial({ color: 0x4c69ff, transparent: true, opacity: 0.035 }));
    this.scene.add(this.coreShell);
    this.coreFlare = this.makeLensFlareGroup(0xa7efff);
    this.scene.add(this.coreFlare);
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
    this.pulsePoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xb3f5ff, size: 3.8, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending, vertexColors: true }));
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
      this.applyEffects();
      this.updateSidePanel();
      this.updateProblemList();
      this.updateSidebarSections();
      this.updateFocusLane();
      this.updateMobileUI();
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
          stableBasePosition: basePosition.clone(),
          timelinePosition,
          position: basePosition.clone(),
          drift: layer === 'problem' ? 0.1 : 0.18 + (idx % 5) * 0.05,
          wobble: layer === 'problem' ? 1.6 : 2.8 + (idx % 4) * 1.1,
          phase: theta,
          size: cluster.baseSize + (item.importance || 0.4) * (layer === 'problem' ? 3.2 : 2.45),
          alpha: item.severity === 'critical' ? 0.94 : 0.42 + (item.importance || 0.4) * 0.45,
          searchable: `${item.title || ''} ${item.text || ''} ${item.group || ''} ${item.category || ''} ${item.meta || ''}`.toLowerCase(),
          orbitParentId: null,
          orbitRadius: 0,
          orbitSpeed: 0,
          orbitTilt: 0,
          orbitYOffset: 0,
          orbitPhase: theta,
          orbitType: 'free',
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

    const nodeById = new Map(groups.map((node) => [node.id, node]));
    const entityToDevice = new Map();
    const entityToArea = new Map();
    const deviceToArea = new Map();
    groups.forEach((node) => {
      if (node.layer === 'entity') {
        if (node.device_id) entityToDevice.set(node.entity_id || node.id.replace(/^entity-/, ''), node.device_id);
        if (node.area_id) entityToArea.set(node.entity_id || node.id.replace(/^entity-/, ''), node.area_id);
      }
      if (node.layer === 'device' && node.area_id) deviceToArea.set(node.device_id || node.id.replace(/^device-/, ''), node.area_id);
    });

    const chooseParentId = (node) => {
      if (node.layer === 'addon' || node.layer === 'integration') return null;
      if (node.layer === 'area') return null;
      if (node.layer === 'device') return node.area_id ? `area-${node.area_id}` : null;
      if (node.layer === 'entity') return node.device_id ? `device-${node.device_id}` : (node.area_id ? `area-${node.area_id}` : null);
      if (node.layer === 'problem') return node.device_id ? `device-${node.device_id}` : (node.area_id ? `area-${node.area_id}` : null);
      if (node.layer === 'person') return node.area_id ? `area-${node.area_id}` : null;
      if (node.layer === 'automation' || node.layer === 'scene') {
        const relatedEntity = (node.related_entity_ids || [])[0];
        const relatedDevice = relatedEntity ? entityToDevice.get(relatedEntity) : null;
        const relatedArea = relatedEntity ? entityToArea.get(relatedEntity) : null;
        return relatedDevice ? `device-${relatedDevice}` : (relatedArea ? `area-${relatedArea}` : (node.area_id ? `area-${node.area_id}` : null));
      }
      return null;
    };

    groups.forEach((node, idx) => {
      const anchor = node.area_id ? areaAnchors.get(node.area_id) : null;
      const s = idx + 1;
      const orbit = new THREE.Vector3(jitter(s * 0.71, 18), jitter(s * 0.43, 10), jitter(s * 0.97, 16));
      if (anchor) {
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
      }
      node.stableBasePosition = node.basePosition.clone();
      node.orbitParentId = chooseParentId(node);
      node.position = node.basePosition.clone();
    });

    groups.forEach((node, idx) => {
      const s = idx + 1;
      const parent = node.orbitParentId ? nodeById.get(node.orbitParentId) : null;
      if (!parent) return;
      const radiusByLayer = {
        device: 16,
        entity: 9,
        automation: 18,
        scene: 20,
        problem: 12,
        person: 15,
      };
      const spreadByLayer = {
        device: 10,
        entity: 7,
        automation: 10,
        scene: 10,
        problem: 6,
        person: 7,
      };
      node.orbitType = 'parent';
      node.orbitRadius = (radiusByLayer[node.layer] || 14) + Math.abs(jitter(s * 0.51, spreadByLayer[node.layer] || 8));
      node.orbitSpeed = 0.18 + ((idx % 7) * 0.035) + (node.layer === 'entity' ? 0.08 : 0) + (node.layer === 'problem' ? 0.04 : 0);
      node.orbitTilt = jitter(s * 0.83, 0.42);
      node.orbitYOffset = jitter(s * 0.37, node.layer === 'entity' ? 6 : 9);
      node.orbitPhase = node.phase + jitter(s * 0.19, 1.2);
      const initialOffset = new THREE.Vector3(
        Math.cos(node.orbitPhase) * node.orbitRadius,
        node.orbitYOffset,
        Math.sin(node.orbitPhase) * node.orbitRadius * (0.7 + Math.abs(node.orbitTilt) * 0.4)
      );
      node.basePosition = parent.basePosition.clone().add(initialOffset);
      node.stableBasePosition = node.basePosition.clone();
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
    this.orbitRingObjects = [];
    this.nebulaObjects = [];

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
      const shellMaterial = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: node.layer === 'area' ? 1.35 : (node.severity === 'critical' ? 1.08 : 0.62), roughness: 0.24, metalness: node.layer === 'scene' || node.layer === 'automation' ? 0.16 : 0.05, clearcoat: 0.7, clearcoatRoughness: 0.35, transparent: true, opacity: Math.min(0.98, node.alpha) });
      const mesh = new THREE.Mesh(sphereGeo.clone(), shellMaterial);
      mesh.position.copy(node.position);
      mesh.scale.setScalar(node.size);
      mesh.userData.node = node;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softGlowTexture, color, transparent: true, opacity: node.layer === 'area' ? 0.12 : (node.severity === 'critical' ? 0.16 : 0.055), blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(node.size * (node.layer === 'area' ? 3.1 : (node.severity === 'critical' ? 2.15 : 1.38)));
      mesh.add(halo);
      mesh.userData.halo = halo;
      if (node.layer === 'area') {
        const starGlow = this.makeLensFlareGroup(color);
        starGlow.scale.setScalar(node.size * 1.55);
        mesh.add(starGlow);
        mesh.userData.starGlow = starGlow;
        const nebula = new THREE.Mesh(
          new THREE.SphereGeometry(1.8, 24, 24),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        nebula.position.copy(node.position);
        nebula.scale.set(node.size * 10.5, node.size * 4.8, node.size * 9.2);
        nebula.rotation.z = node.phase || 0;
        nebula.userData.nodeId = node.id;
        this.clusterRoot.add(nebula);
        this.nebulaObjects.push(nebula);
      }
      this.graphRoot.add(mesh);
      this.nodeObjects.push(mesh);
      this.nodeMap.set(node.id, mesh);
      this.labelsEl.appendChild(this.createLabelElement(node));
    }

    for (const node of this.nodes) {
      if (!node.orbitParentId || !node.orbitRadius) continue;
      const parentMesh = this.nodeMap.get(node.orbitParentId);
      if (!parentMesh) continue;
      const ringThickness = node.layer === 'entity' ? 0.08 : node.layer === 'automation' ? 0.12 : node.layer === 'scene' ? 0.14 : node.layer === 'problem' ? 0.16 : 0.11;
      const ringOpacity = node.layer === 'entity' ? 0.10 : node.layer === 'automation' ? 0.16 : node.layer === 'scene' ? 0.18 : node.layer === 'problem' ? 0.22 : 0.15;
      const orbitRing = new THREE.Mesh(
        new THREE.TorusGeometry(node.orbitRadius, ringThickness, 10, node.layer === 'entity' ? 84 : 108),
        new THREE.MeshBasicMaterial({ color: this.colorFor(node), transparent: true, opacity: ringOpacity })
      );
      orbitRing.position.copy(parentMesh.position);
      orbitRing.rotation.x = Math.PI / 2 + node.orbitTilt;
      orbitRing.rotation.z = node.orbitTilt * 0.65;
      orbitRing.userData.nodeId = node.id;
      orbitRing.userData.parentId = node.orbitParentId;
      orbitRing.userData.layer = node.layer;
      this.clusterRoot.add(orbitRing);
      this.orbitRingObjects.push(orbitRing);
    }

    const pairs = [];
    const positions = [];
    const colors = [];
    for (const link of this.linkDefs) {
      const a = this.nodeMap.get(link.source);
      const b = this.nodeMap.get(link.target);
      if (!a || !b) continue;
      const relationColor = this.relationColor(link.relation);
      pairs.push({ a, b, relation: link.relation, weight: link.weight || 1, key: `${link.source}|${link.target}|${link.relation}`, baseColor: relationColor });
      positions.push(a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z);
      colors.push(...relationColor, ...relationColor);
    }
    this.linkPairs = pairs;
    if (positions.length) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.18 }));
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
    this.pulseSpeeds = Array.from({ length: count }, (_, idx) => {
      const relation = this.linkPairs[idx]?.relation || '';
      if (/problem|unavailable/i.test(relation)) return 0.92;
      if (/automation|triggers|controls/i.test(relation)) return 0.84;
      if (/scene/i.test(relation)) return 0.72;
      if (/person|presence/i.test(relation)) return 0.66;
      return 0.6 + ((idx % 5) * 0.08);
    });
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const base = this.linkPairs[i]?.baseColor || [0.7, 0.9, 1.0];
      colors[i * 3] = base[0];
      colors[i * 3 + 1] = base[1];
      colors[i * 3 + 2] = base[2];
    }
    this.pulsePoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.pulsePoints.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
      this.nudgeMobileChrome();
      if (this.hoveredNode?.id) this.selectNodeById(this.hoveredNode.id);
      else { this.selectedNode = { title: this.data?.core?.title || 'Hermes HA Cloud', type: 'core', layer: 'core', text: this.data?.core?.text || '' }; this.updateSidePanel(); }
    });
    this.searchEl?.addEventListener('input', (ev) => {
      this.searchQuery = String(ev.target.value || '').trim().toLowerCase();
      this.applyVisibility();
      this.updateFocusLane();
      this.updateSidePanel();
    });
    this.mobileControlsToggleEl?.addEventListener('click', () => {
      this.drawerOpen = !this.drawerOpen;
      this.updateDrawerUI();
      this.savePreferences();
    });
    this.drawerToggleEl?.addEventListener('click', () => {
      this.drawerOpen = !this.drawerOpen;
      this.updateDrawerUI();
      this.savePreferences();
    });
    this.drawerCloseEl?.addEventListener('click', () => {
      this.drawerOpen = false;
      this.updateDrawerUI();
      this.savePreferences();
    });
    this.drawerOverlayEl?.addEventListener('click', () => {
      this.drawerOpen = false;
      this.updateDrawerUI();
      this.savePreferences();
    });
    this.shadowRoot.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.drawerOpen) {
        this.drawerOpen = false;
        this.updateDrawerUI();
        this.savePreferences();
      }
    });
    this.settingsToggleEl?.addEventListener('click', () => {
      this.settingsCollapsed = !this.settingsCollapsed;
      const shell = this.shadowRoot.getElementById('settings-shell');
      if (shell) shell.classList.toggle('collapsed', this.settingsCollapsed);
      this.savePreferences();
    });
    this.mobileMiniMapToggleEl?.addEventListener('click', () => {
      this.mobileMiniMapVisible = !this.mobileMiniMapVisible;
      this.updateMobileUI();
      this.drawMiniMap();
    });
    this.mobileCloudActionsEl?.querySelectorAll('button[data-cloud-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.cloudAction;
        if (action === 'drawer') {
          this.drawerOpen = true;
          this.updateDrawerUI();
          this.savePreferences();
          return;
        }
        if (action === 'snapshot') {
          this.mobileTab = 'snapshot';
          this.windowPreset = 'snapshot';
        } else if (action === 'problem') {
          this.mobileTab = 'problem';
          this.windowPreset = 'problem';
        }
        this.updateControlPills();
        this.updateMobileUI();
      });
    });
    this.mobileBottomNavEl?.querySelectorAll('button[data-bottom-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.bottomTab;
        if (tab === 'drawer') {
          this.drawerOpen = true;
          this.mobileChromeHidden = false;
          this.updateDrawerUI();
          this.updateMobileUI();
          this.savePreferences();
          return;
        }
        this.mobileTab = tab || 'cloud';
        this.windowPreset = this.mobileTab === 'cloud' ? 'overview' : this.mobileTab;
        this.mobileChromeHidden = false;
        this.updateControlPills();
        this.updateMobileUI();
      });
    });
    this.desktopHeaderTabsEl?.querySelectorAll('button[data-window-target]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.windowTarget;
        if (target === 'drawer') {
          this.drawerOpen = true;
          this.updateDrawerUI();
          this.updateMobileUI();
          this.savePreferences();
          return;
        }
        this.windowPreset = target || 'overview';
        this.updateWindowPreset();
        this.updateMobileUI();
        this.updateControlPills();
        this.savePreferences();
      });
    });
    this.sidebarTabsDesktopEl?.querySelectorAll('button[data-sidebar-view]').forEach((button) => {
      button.addEventListener('click', () => {
        this.sidebarView = button.dataset.sidebarView || 'panels';
        this.updateDesktopArcUI();
        this.savePreferences();
      });
    });
    this.mobileTabsEl?.querySelectorAll('button[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.mobileTab = button.dataset.tab || 'cloud';
        this.windowPreset = this.mobileTab === 'cloud'
          ? 'overview'
          : this.mobileTab === 'snapshot'
            ? 'snapshot'
            : this.mobileTab;
        this.mobileChromeHidden = false;
        this.updateControlPills();
        this.updateMobileUI();
      });
    });
  }

  isMobileLayout() {
    return (this.width || window.innerWidth || 0) <= 720;
  }

  updateDrawerUI() {
    const mobile = this.isMobileLayout();
    const open = mobile ? !!this.drawerOpen : !!this.drawerOpen;
    this.drawerShellEl?.classList.toggle('open', open);
    this.drawerOverlayEl?.classList.toggle('open', open);
    this.drawerToggleEl?.classList.toggle('active', open);
    this.mobileControlsToggleEl?.classList.toggle('active', open);
    if (this.mobileControlsBodyEl) this.mobileControlsBodyEl.classList.toggle('collapsed', !open);
  }

  updateDesktopArcUI() {
    this.panelAsideEl?.setAttribute('data-sidebar-view', this.sidebarView || 'panels');
    this.sidebarTabsDesktopEl?.querySelectorAll('button[data-sidebar-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.sidebarView === this.sidebarView);
    });
    this.desktopHeaderTabsEl?.querySelectorAll('button[data-window-target]').forEach((button) => {
      const target = button.dataset.windowTarget;
      const active = target === 'drawer' ? this.drawerOpen : target === (this.windowPreset || 'overview');
      button.classList.toggle('active', !!active);
    });
  }

  updateMobileUI() {
    const mobile = this.isMobileLayout();
    const controlsBtn = this.mobileControlsToggleEl;
    const mapBtn = this.mobileMiniMapToggleEl;
    const tabs = this.mobileTabsEl;
    const aside = tabs?.parentElement;
    const isCloudMode = mobile && this.mobileTab === 'cloud';
    this.updateDrawerUI();
    this.updateDesktopArcUI();
    this.sceneWrapEl?.setAttribute('data-mobile-mode', isCloudMode ? 'cloud' : 'panel');
    this.sceneWrapEl?.setAttribute('data-mobile-chrome', this.mobileChromeHidden && isCloudMode ? 'hidden' : 'visible');
    this.mobileCloudActionsEl?.classList.toggle('active-cloud', isCloudMode);
    this.mobileCloudActionsEl && (this.mobileCloudActionsEl.style.display = isCloudMode ? 'flex' : 'none');
    this.mobileBottomNavEl && (this.mobileBottomNavEl.style.display = mobile ? 'flex' : 'none');
    if (this.minimapWrapEl) this.minimapWrapEl.classList.toggle('hidden-mobile', mobile && !this.mobileMiniMapVisible && !isCloudMode);
    if (controlsBtn) controlsBtn.classList.toggle('active', mobile && this.drawerOpen);
    if (mapBtn) mapBtn.classList.toggle('active', mobile && (this.mobileMiniMapVisible || isCloudMode));
    if (aside) {
      if (mobile) aside.setAttribute('data-mobile-tab', this.mobileTab);
      else aside.removeAttribute('data-mobile-tab');
    }
    tabs?.querySelectorAll('button[data-tab]').forEach((button) => button.classList.toggle('active', mobile && button.dataset.tab === this.mobileTab));
    this.mobileBottomNavEl?.querySelectorAll('button[data-bottom-tab]').forEach((button) => {
      const tab = button.dataset.bottomTab;
      const active = tab === 'drawer' ? this.drawerOpen : mobile && tab === this.mobileTab;
      button.classList.toggle('active', !!active);
    });
    this.mobileCloudActionsEl?.querySelectorAll('button[data-cloud-action]').forEach((button) => {
      const action = button.dataset.cloudAction;
      const active = (action === 'snapshot' && this.mobileTab === 'snapshot') || (action === 'problem' && this.mobileTab === 'problem');
      button.classList.toggle('active', mobile && active);
    });
  }

  nudgeMobileChrome() {
    if (!this.isMobileLayout() || this.mobileTab !== 'cloud') return;
    this.mobileChromeHidden = true;
    this.updateMobileUI();
    clearTimeout(this.mobileChromeTimer);
    this.mobileChromeTimer = setTimeout(() => {
      this.mobileChromeHidden = false;
      this.updateMobileUI();
    }, 1600);
  }

  onPointerMove(ev) {
    if (!this.renderer || !this.camera) return;
    this.nudgeMobileChrome();
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.nodeObjects);
    const hit = hits.find((entry) => entry.object?.userData?.node && entry.object.visible);
    this.hoveredNode = hit?.object?.userData?.node || null;
    this.updateSidePanel();
  }

  updateWindowPreset() {
    if (!this.panelAsideEl) return;
    const preset = this.windowPreset || 'overview';
    this.panelAsideEl.setAttribute('data-window-preset', preset);
    if (this.isMobileLayout()) {
      const mobileMap = { overview: 'cloud', snapshot: 'snapshot', relations: 'relations', focus: 'focus', problem: 'problem' };
      this.mobileTab = mobileMap[preset] || this.mobileTab;
    }
  }

  applyEffects() {
    this.orbitRingObjects?.forEach((ring) => { ring.visible = !!this.effects.orbitRings; });
    this.nebulaObjects?.forEach((nebula) => { nebula.visible = !!this.effects.nebulas; });
    if (this.pulsePoints) this.pulsePoints.visible = !!this.effects.relationTraffic;
    if (this.coreGlow) this.coreGlow.visible = !!this.effects.cinematicGlow;
    if (this.coreShell) this.coreShell.visible = !!this.effects.cinematicGlow;
    if (this.coreFlare) this.coreFlare.visible = !!this.effects.cinematicGlow;
    this.rings?.forEach((ring) => { ring.visible = !!this.effects.cinematicGlow; });
    this.nodeObjects?.forEach((mesh) => {
      if (mesh.userData.starGlow) mesh.userData.starGlow.visible = !!this.effects.cinematicGlow;
      if (mesh.userData.halo) mesh.userData.halo.visible = true;
    });
  }

  applyPresetProfile(profile) {
    const presets = {
      clean: {
        presetProfile: 'clean',
        effects: { orbitRings: false, nebulas: false, relationTraffic: false, autoZoom: false, cinematicGlow: false },
        windowPreset: 'overview', viewMode: 'constellation', motionMode: 'still', labelMode: 'normal'
      },
      galaxy: {
        presetProfile: 'galaxy',
        effects: { orbitRings: true, nebulas: true, relationTraffic: true, autoZoom: true, cinematicGlow: true },
        windowPreset: 'overview', viewMode: 'constellation', motionMode: 'calm', labelMode: 'normal'
      },
      debug: {
        presetProfile: 'debug',
        effects: { orbitRings: true, nebulas: false, relationTraffic: true, autoZoom: false, cinematicGlow: false },
        windowPreset: 'relations', viewMode: 'timeline', motionMode: 'still', labelMode: 'detailed'
      },
      problems: {
        presetProfile: 'problems',
        effects: { orbitRings: true, nebulas: false, relationTraffic: true, autoZoom: true, cinematicGlow: true },
        windowPreset: 'problem', viewMode: 'constellation', motionMode: 'calm', labelMode: 'detailed'
      },
    };
    const preset = presets[profile];
    if (!preset) return;
    this.presetProfile = preset.presetProfile;
    this.effects = { ...this.effects, ...preset.effects };
    this.windowPreset = preset.windowPreset;
    this.viewMode = preset.viewMode;
    this.motionMode = preset.motionMode;
    this.labelMode = preset.labelMode;
    this.autoDrift = this.motionMode === 'live' ? 0.0001 : this.motionMode === 'still' ? 0 : 0.00004;
    this.applyEffects();
    this.updateWindowPreset();
    this.updateMobileUI();
    this.updateDrawerUI();
    this.updateControlPills();
    this.updateFocusLane();
    this.drawMiniMap();
    this.savePreferences();
  }

  updateControlPills() {
    const build = (host, active, entries, onPick, multiple = false) => {
      if (!host) return;
      host.innerHTML = '';
      entries.forEach(([value, label]) => {
        const button = document.createElement('button');
        button.textContent = label;
        const isActive = multiple ? !!active[value] : active === value;
        if (isActive) button.classList.add('active');
        button.addEventListener('click', () => onPick(value));
        host.appendChild(button);
      });
    };
    build(this.viewModeEl, this.viewMode, [['constellation', '🌌 Constellation'], ['timeline', '🧭 Timeline']], (value) => { this.viewMode = value; this.updateControlPills(); this.drawMiniMap(); this.savePreferences(); });
    build(this.labelModeEl, this.labelMode, [['minimal', '🔤 Minimal'], ['normal', '📝 Normal'], ['detailed', '📚 Detailed']], (value) => { this.labelMode = value; this.updateControlPills(); this.updateFocusLane(); this.savePreferences(); });
    build(this.motionModeEl, this.motionMode, [['calm', '🌫 Calm'], ['live', '⚡ Live'], ['still', '⏸ Still']], (value) => { this.motionMode = value; this.autoDrift = value === 'live' ? 0.0001 : value === 'still' ? 0 : 0.00004; this.updateControlPills(); this.savePreferences(); });
    build(this.presetProfilesEl, this.presetProfile, [['clean', '🧼 Clean HA'], ['galaxy', '🌌 Galaxy'], ['debug', '🛠 Debug'], ['problems', '🚨 Problems']], (value) => this.applyPresetProfile(value));
    build(this.effectsEl, this.effects, [['orbitRings', '🪐 Orbitbanor'], ['nebulas', '☁️ Nebulosor'], ['relationTraffic', '🔗 Länktrafik'], ['autoZoom', '🎯 Auto-zoom'], ['cinematicGlow', '✨ Glow']], (value) => {
      this.effects[value] = !this.effects[value];
      this.applyEffects();
      this.updateControlPills();
      this.drawMiniMap();
      this.savePreferences();
    }, true);
    build(this.windowPresetsEl, this.windowPreset, [['overview', '🪟 Översikt'], ['snapshot', '📸 Snapshot'], ['relations', '🧬 Kopplingar'], ['focus', '🎯 Fokus'], ['problem', '⚠️ Problem']], (value) => {
      this.windowPreset = value;
      this.updateWindowPreset();
      this.updateMobileUI();
      if (this.panelAsideEl && !this.isMobileLayout()) this.panelAsideEl.scrollTo({ top: 0, behavior: 'smooth' });
      this.updateControlPills();
      this.savePreferences();
    });
    this.updateWindowPreset();
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
        this.updateSidebarSections();
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
    this.focusOnNode(this.selectedNode);
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

  relationColor(relation = '') {
    const key = String(relation || '').toLowerCase();
    if (key.includes('problem') || key.includes('unavailable')) return [1.0, 0.42, 0.42];
    if (key.includes('automation') || key.includes('triggers') || key.includes('controls')) return [0.98, 0.74, 0.34];
    if (key.includes('scene')) return [0.78, 0.56, 1.0];
    if (key.includes('person') || key.includes('presence')) return [0.44, 0.98, 0.74];
    if (key.includes('area') || key.includes('room')) return [0.38, 0.84, 1.0];
    if (key.includes('device')) return [0.50, 0.78, 1.0];
    return [0.525, 0.761, 1.0];
  }

  focusOnNode(node) {
    if (!this.effects?.autoZoom) return;
    if (!node?.id || !this.camera || !this.controls) return;
    const mesh = this.nodeMap.get(node.id);
    if (!mesh) return;
    const lineage = [...this.getLineageIds(node)].map((id) => this.nodeMap.get(id)?.position).filter(Boolean);
    const center = mesh.position.clone();
    if (lineage.length) {
      const sum = lineage.reduce((acc, pos) => acc.add(pos), new THREE.Vector3());
      center.copy(sum.multiplyScalar(1 / lineage.length));
    }
    let maxDist = 24;
    lineage.forEach((pos) => { maxDist = Math.max(maxDist, center.distanceTo(pos)); });
    const distance = Math.min(420, Math.max(150, maxDist * 3.1));
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.lerp(center, 0.85);
    this.camera.position.lerp(center.clone().add(dir.multiplyScalar(distance)).add(new THREE.Vector3(0, maxDist * 0.25, 0)), 0.9);
    this.controls.update();
  }

  getLineageIds(node) {
    if (!node?.id) return new Set();
    const ids = new Set([node.id]);
    let cursor = node;
    const guard = new Set();
    while (cursor?.orbitParentId && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      ids.add(cursor.orbitParentId);
      cursor = this.getNodeById(cursor.orbitParentId);
    }
    const queue = [node.id];
    while (queue.length) {
      const parentId = queue.shift();
      this.nodes.forEach((candidate) => {
        if (candidate.orbitParentId === parentId && !ids.has(candidate.id)) {
          ids.add(candidate.id);
          queue.push(candidate.id);
        }
      });
    }
    return ids;
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
    const problems = this.data?.problem_devices || [];
    if (this.problemListEl) {
      this.problemListEl.innerHTML = '';
      if (!problems.length) {
        this.problemListEl.innerHTML = '<div class="empty">Inga problem-enheter just nu.</div>';
      } else {
        problems.slice(0, 10).forEach((item) => {
          const button = document.createElement('button');
          button.className = 'row';
          button.innerHTML = `<strong>${this.escapeHtml(item.title)}</strong><small>${this.escapeHtml(item.meta || item.text || '')}</small>`;
          button.addEventListener('click', () => this.selectNodeById(item.id));
          this.problemListEl.appendChild(button);
        });
      }
    }
    if (this.sidebarProblemsEl) {
      this.sidebarProblemsEl.innerHTML = '';
      if (!problems.length) {
        this.sidebarProblemsEl.innerHTML = '<div class="empty">Inga problem-enheter just nu.</div>';
      } else {
        problems.slice(0, 12).forEach((item) => {
          const button = document.createElement('button');
          button.className = 'row';
          button.innerHTML = `<strong>${this.escapeHtml(item.title)}</strong><small>${this.escapeHtml(item.meta || item.text || '')}</small>`;
          button.addEventListener('click', () => this.selectNodeById(item.id));
          this.sidebarProblemsEl.appendChild(button);
        });
      }
    }
  }

  updateSidebarSections() {
    const areaNodes = this.nodes.filter((node) => node.layer === 'area').sort((a, b) => (b.importance || 0) - (a.importance || 0));
    const deviceNodes = this.visibleNodesSorted().filter((node) => node.layer === 'device');
    if (this.sidebarRoomsEl) {
      this.sidebarRoomsEl.innerHTML = '';
      areaNodes.slice(0, 10).forEach((item) => {
        const button = document.createElement('button');
        button.className = 'row';
        button.innerHTML = `<strong>${this.escapeHtml(item.title)}</strong><small>${this.escapeHtml(item.meta || 'Area')}</small>`;
        button.addEventListener('click', () => this.selectNodeById(item.id));
        this.sidebarRoomsEl.appendChild(button);
      });
      if (!areaNodes.length) this.sidebarRoomsEl.innerHTML = '<div class="empty">Inga areas hittades.</div>';
    }
    if (this.sidebarDevicesEl) {
      this.sidebarDevicesEl.innerHTML = '';
      deviceNodes.slice(0, 12).forEach((item) => {
        const button = document.createElement('button');
        button.className = 'row';
        button.innerHTML = `<strong>${this.escapeHtml(item.title)}</strong><small>${this.escapeHtml(item.meta || item.group || 'Device')}</small>`;
        button.addEventListener('click', () => this.selectNodeById(item.id));
        this.sidebarDevicesEl.appendChild(button);
      });
      if (!deviceNodes.length) this.sidebarDevicesEl.innerHTML = '<div class="empty">Inga enheter i nuvarande filter.</div>';
    }
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
    this.updateInspectorPanel(item, related);
    this.updateFocusPaths();
  }

  updateInspectorPanel(item, related = []) {
    if (!this.inspectorShellEl || !this.inspectorTitleEl || !this.inspectorTypeEl || !this.inspectorBodyEl || !this.inspectorMetaEl || !this.inspectorRelationsEl) return;
    const node = item || this.selectedNode || this.hoveredNode;
    if (!node) {
      this.inspectorTypeEl.textContent = 'Inspector';
      this.inspectorTitleEl.textContent = 'Hermes HA Cloud';
      this.inspectorBodyEl.textContent = 'Välj en nod i grafen för att se metadata, relationer och fokusvägar utan att lämna molnvyn.';
      this.inspectorMetaEl.innerHTML = '';
      this.inspectorRelationsEl.innerHTML = '';
      return;
    }
    const chips = [];
    if (node.layer && node.layer !== 'core') chips.push(node.layer);
    if (node.group) chips.push(node.group);
    if (node.category) chips.push(node.category);
    if (node.state) chips.push(`state ${node.state}`);
    if (node.meta) chips.push(node.meta);
    this.inspectorTypeEl.textContent = String(node.layer || node.type || 'core').toUpperCase();
    this.inspectorTitleEl.textContent = node.title || 'Untitled node';
    this.inspectorBodyEl.textContent = node.text || 'Ingen extra beskrivning tillgänglig för vald nod ännu.';
    this.inspectorMetaEl.innerHTML = `
      <div class="inspector-section-title">Metadata</div>
      <div class="inspector-pill-grid">${chips.length ? chips.map((chip) => `<span class="inspector-pill">${this.escapeHtml(chip)}</span>`).join('') : '<span class="inspector-pill">Ingen metadata</span>'}</div>
    `;
    const topRelated = related.slice(0, 4);
    this.inspectorRelationsEl.innerHTML = `<div class="inspector-section-title">Strongest connections</div>`;
    if (!topRelated.length) {
      this.inspectorRelationsEl.innerHTML += '<div class="empty">Inga tydliga kopplingar för vald nod ännu.</div>';
      return;
    }
    topRelated.forEach((rel) => {
      const button = document.createElement('button');
      button.className = 'inspector-rel-btn';
      button.innerHTML = `<strong>${this.escapeHtml(rel.title)}</strong><small>${this.escapeHtml(rel.relation)} · ${this.escapeHtml(rel.meta || rel.group || rel.layer || '')}</small>`;
      button.addEventListener('click', () => this.selectNodeById(rel.id));
      this.inspectorRelationsEl.appendChild(button);
    });
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
    this.updateMobileUI();
    this.drawMiniMap();
  }

  animate(time) {
    const dt = Math.min(32, time - this.lastTime);
    this.lastTime = time;
    const t = time * 0.001;
    const motionFactor = this.motionMode === 'live' ? 1.9 : this.motionMode === 'still' ? 0 : 1;
    const focusNode = this.selectedNode || this.hoveredNode;
    const lineageIds = this.getLineageIds(focusNode);
    this.graphRoot.rotation.y += this.autoDrift * dt;
    this.coreGlow.scale.setScalar(1 + Math.sin(t * 1.2) * 0.035);
    this.coreShell.rotation.y -= this.autoDrift * dt * 3;
    this.coreShell.rotation.x += this.autoDrift * dt * 1.3;
    if (this.coreFlare) {
      this.coreFlare.position.copy(this.coreGlow.position);
      this.coreFlare.rotation.z += 0.00022 * dt;
      this.coreFlare.scale.setScalar(1 + Math.sin(t * 1.4) * 0.028);
    }
    if (this.starfield) { this.starfield.rotation.y += 0.000012 * dt * (motionFactor || 0.2); this.starfield.rotation.x = Math.sin(t * 0.08) * 0.18; }
    this.rings?.forEach((ring, idx) => { ring.rotation.y += (0.00005 + idx * 0.000015) * dt * (motionFactor || 0.15); ring.rotation.z += (0.00003 + idx * 0.00001) * dt * (motionFactor || 0.1); });

    const positions = this.pulsePoints.geometry.attributes.position?.array;
    const livePositionById = new Map(this.nodeObjects.map((mesh) => [mesh.userData.node.id, mesh.position.clone()]));
    for (const mesh of this.nodeObjects) {
      const node = mesh.userData.node;
      const orbitalBase = (() => {
        if (this.viewMode === 'timeline') return node.timelinePosition;
        if (node.orbitParentId) {
          const parentPos = livePositionById.get(node.orbitParentId) || this.nodeMap.get(node.orbitParentId)?.position || node.stableBasePosition;
          const angle = node.orbitPhase + t * node.orbitSpeed * motionFactor;
          const ellipse = 0.72 + Math.abs(node.orbitTilt || 0) * 0.45;
          return new THREE.Vector3(
            parentPos.x + Math.cos(angle) * node.orbitRadius,
            parentPos.y + node.orbitYOffset + Math.sin(angle * 0.8 + node.orbitTilt) * (node.orbitRadius * 0.08),
            parentPos.z + Math.sin(angle) * node.orbitRadius * ellipse
          );
        }
        return node.stableBasePosition || node.basePosition;
      })();
      node.basePosition = orbitalBase.clone();
      const animated = new THREE.Vector3(
        orbitalBase.x + Math.cos(t * node.drift * motionFactor + node.phase) * node.wobble,
        orbitalBase.y + Math.sin(t * node.drift * 1.6 * motionFactor + node.phase) * (node.wobble * 0.45),
        orbitalBase.z + Math.sin(t * node.drift * 1.1 * motionFactor + node.phase * 0.7) * (node.wobble * 0.8)
      );
      node.position.lerp(animated, 0.12);
      mesh.position.copy(node.position);
      livePositionById.set(node.id, mesh.position.clone());
      const active = this.hoveredNode?.id === node.id || this.selectedNode?.id === node.id;
      const inLineage = lineageIds.has(node.id);
      const scale = active ? node.size * 1.22 : inLineage ? node.size * 1.08 : node.size;
      mesh.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.18);
      mesh.material.emissiveIntensity = active ? 1.55 : inLineage ? 1.15 : node.layer === 'area' ? 1.15 : node.severity === 'critical' ? 1.18 : 0.72;
      mesh.material.opacity = active ? 1 : inLineage ? Math.min(0.99, node.alpha + 0.12) : Math.min(0.98, node.alpha);
      if (mesh.userData.halo) mesh.userData.halo.material.opacity = active ? 0.14 : inLineage ? 0.09 : (node.layer === 'area' ? 0.12 : (node.severity === 'critical' ? 0.12 : 0.055));
      if (mesh.userData.starGlow) mesh.userData.starGlow.children?.forEach((sprite, idx) => { sprite.material.opacity = active ? (idx === 0 ? 0.18 : 0.12) : inLineage ? (idx === 0 ? 0.13 : 0.09) : (idx === 0 ? 0.10 : 0.065); });
    }

    this.orbitRingObjects?.forEach((ring) => {
      const parentMesh = this.nodeMap.get(ring.userData.parentId);
      const nodeId = ring.userData.nodeId;
      if (parentMesh) ring.position.copy(parentMesh.position);
      const active = nodeId && lineageIds.has(nodeId);
      const layerBoost = ring.userData.layer === 'problem' ? 0.22 : ring.userData.layer === 'scene' ? 0.18 : ring.userData.layer === 'automation' ? 0.16 : ring.userData.layer === 'entity' ? 0.10 : 0.14;
      ring.material.opacity = active ? Math.max(0.34, layerBoost + 0.12) : layerBoost;
      ring.scale.setScalar(active ? 1.03 : 1);
    });

    this.nebulaObjects?.forEach((nebula, idx) => {
      const sourceMesh = this.nodeMap.get(nebula.userData.nodeId);
      if (!sourceMesh) return;
      nebula.position.copy(sourceMesh.position);
      nebula.rotation.y += 0.00035 * dt * (1 + ((idx % 3) * 0.2));
      nebula.rotation.z += 0.00018 * dt;
      const active = lineageIds.has(nebula.userData.nodeId);
      nebula.material.opacity = active ? 0.07 : 0.04;
    });

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
      const colorAttr = this.lines.geometry.attributes.color.array;
      let k = 0;
      let c = 0;
      this.linkPairs.forEach(({ a, b, baseColor }, idx) => {
        const aId = a.userData.node.id;
        const bId = b.userData.node.id;
        const active = lineageIds.size && lineageIds.has(aId) && lineageIds.has(bId);
        pos[k++] = a.position.x; pos[k++] = a.position.y; pos[k++] = a.position.z;
        pos[k++] = b.position.x; pos[k++] = b.position.y; pos[k++] = b.position.z;
        const color = active ? [Math.min(1, baseColor[0] + 0.18), Math.min(1, baseColor[1] + 0.16), Math.min(1, baseColor[2] + 0.12)] : baseColor;
        colorAttr[c++] = color[0]; colorAttr[c++] = color[1]; colorAttr[c++] = color[2];
        colorAttr[c++] = color[0]; colorAttr[c++] = color[1]; colorAttr[c++] = color[2];
        if (positions && idx < this.pulseCount) {
          this.pulseProgress[idx] = (this.pulseProgress[idx] + dt * 0.00035 * this.pulseSpeeds[idx]) % 1;
          const p = this.pulseProgress[idx];
          positions[idx * 3] = a.position.x + (b.position.x - a.position.x) * p;
          positions[idx * 3 + 1] = a.position.y + (b.position.y - a.position.y) * p;
          positions[idx * 3 + 2] = a.position.z + (b.position.z - a.position.z) * p;
          const pulseColors = this.pulsePoints.geometry.attributes.color?.array;
          if (pulseColors) {
            pulseColors[idx * 3] = color[0];
            pulseColors[idx * 3 + 1] = color[1];
            pulseColors[idx * 3 + 2] = color[2];
          }
        }
      });
      this.lines.material.opacity = lineageIds.size ? 0.32 : 0.18;
      this.lines.geometry.attributes.position.needsUpdate = true;
      this.lines.geometry.attributes.color.needsUpdate = true;
      if (this.pulsePoints.geometry.attributes.position) this.pulsePoints.geometry.attributes.position.needsUpdate = true;
      if (this.pulsePoints.geometry.attributes.color) this.pulsePoints.geometry.attributes.color.needsUpdate = true;
    }

    this.updateLabelAnchors();
    this.drawMiniMap();
    this.controls?.update();
    this.renderer?.render(this.scene, this.camera);
    this.raf = requestAnimationFrame((next) => this.animate(next));
  }
}

customElements.define('hermes-ha-cloud-panel', HermesHACloudPanel);
