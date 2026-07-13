from __future__ import annotations

import os
import json
from collections import Counter, defaultdict
from typing import Any

from aiohttp import web
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.device_registry import async_get as async_get_device_registry
from homeassistant.helpers.entity_registry import async_get as async_get_entity_registry
from homeassistant.helpers.http import HomeAssistantView
from homeassistant.helpers.json import JSONEncoder

from .const import API_URL

IGNORE_DOMAINS = {"hermes_mind_cloud", "hermes_ha_cloud"}
IGNORE_ENTITY_PREFIXES = ("sensor.tapo_c220_", "binary_sensor.tapo_c220_", "switch.tapo_c220_", "light.tapo_c220_", "camera.tapo_c220_")


def _state_obj(hass, entity_id: str):
    return hass.states.get(entity_id)


def _clip(text: str, size: int = 220) -> str:
    text = (text or "").strip()
    return text if len(text) <= size else text[: size - 1] + "…"


async def _fetch_supervisor_addons(hass) -> list[dict[str, Any]]:
    token = os.environ.get("SUPERVISOR_TOKEN") or os.environ.get("HASSIO_TOKEN")
    if not token:
        return []
    session = async_get_clientsession(hass)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with session.get("http://supervisor/addons", headers=headers, timeout=20) as resp:
            if resp.status != 200:
                return []
            payload = await resp.json()
    except Exception:
        return []
    addons = payload.get("data", {}).get("addons", [])
    out = []
    for addon in addons:
        slug = addon.get("slug") or addon.get("name") or "addon"
        state = addon.get("state") or "unknown"
        out.append({
            "id": f"addon-{slug}",
            "type": "memory",
            "group": "addon",
            "title": addon.get("name") or slug,
            "text": _clip(addon.get("description") or f"Add-on state: {state}"),
            "category": addon.get("repository") or addon.get("slug") or "addon",
            "importance": 0.95 if state == "started" else 0.72,
            "meta": f"state {state}",
            "state": state,
            "slug": slug,
        })
    return out


def _build_snapshot(hass, addons: list[dict[str, Any]]) -> dict[str, Any]:
    er = async_get_entity_registry(hass)
    dr = async_get_device_registry(hass)
    entries = [e for e in hass.config_entries.async_entries() if e.domain not in IGNORE_DOMAINS]

    entities_by_config = defaultdict(list)
    entities_by_device = defaultdict(list)
    unavailable_counts_by_device = Counter()
    domain_counts_by_device = defaultdict(Counter)

    entity_nodes = []
    for entity in er.entities.values():
        if any(entity.entity_id.startswith(prefix) for prefix in IGNORE_ENTITY_PREFIXES):
            continue
        state_obj = _state_obj(hass, entity.entity_id)
        state = state_obj.state if state_obj else "unknown"
        is_unavailable = state == "unavailable"
        domain = entity.entity_id.split('.', 1)[0]
        label = entity.original_name or entity.name or entity.entity_id
        area_id = getattr(entity, 'area_id', None)
        device_id = getattr(entity, 'device_id', None)
        if entity.config_entry_id:
            entities_by_config[entity.config_entry_id].append(entity.entity_id)
        if device_id:
            entities_by_device[device_id].append(entity.entity_id)
            domain_counts_by_device[device_id][domain] += 1
            if is_unavailable:
                unavailable_counts_by_device[device_id] += 1

        importance = 0.45
        if is_unavailable:
            importance = 0.98
        elif state in {"on", "home", "playing", "open"}:
            importance = 0.72
        entity_nodes.append({
            "id": f"entity-{entity.entity_id}",
            "type": "tool",
            "group": domain,
            "title": label,
            "text": _clip(f"{entity.entity_id} · state {state}"),
            "category": domain,
            "importance": importance,
            "meta": f"state {state}" + (f" · area {area_id}" if area_id else ""),
            "entity_id": entity.entity_id,
            "state": state,
            "device_id": device_id,
            "config_entry_id": entity.config_entry_id,
        })

    integration_nodes = []
    for entry in entries:
        ent_ids = entities_by_config.get(entry.entry_id, [])
        unavailable = sum(1 for eid in ent_ids if (_state_obj(hass, eid) and _state_obj(hass, eid).state == 'unavailable'))
        title = entry.title or entry.domain
        text = f"Integration domain {entry.domain}. Entities: {len(ent_ids)}."
        meta = [f"domain {entry.domain}", f"entities {len(ent_ids)}", f"state {entry.state}"]
        if unavailable:
            meta.append(f"unavailable {unavailable}")
        integration_nodes.append({
            "id": f"integration-{entry.entry_id}",
            "type": "profile",
            "group": entry.domain,
            "title": title,
            "text": _clip(text),
            "category": entry.domain,
            "importance": min(1.0, 0.55 + min(len(ent_ids), 40) / 80 + min(unavailable, 10) / 20),
            "meta": " · ".join(meta),
            "entry_id": entry.entry_id,
            "state": str(entry.state),
            "use_count": len(ent_ids),
            "view_count": unavailable,
        })

    device_nodes = []
    for device in dr.devices.values():
        entity_ids = entities_by_device.get(device.id, [])
        if not entity_ids:
            continue
        name = device.name_by_user or device.name or next(iter(device.identifiers), ('device', 'device'))[-1]
        unavailable = unavailable_counts_by_device.get(device.id, 0)
        manufacturers = [x for x in [device.manufacturer, device.model] if x]
        domains = ", ".join(f"{k}:{v}" for k, v in domain_counts_by_device.get(device.id, {}).most_common(3))
        area_id = getattr(device, 'area_id', None)
        text = f"{len(entity_ids)} entities" + (f", {unavailable} unavailable" if unavailable else "")
        meta_bits = []
        if manufacturers:
            meta_bits.append(" / ".join(manufacturers))
        if area_id:
            meta_bits.append(f"area {area_id}")
        if domains:
            meta_bits.append(domains)
        device_nodes.append({
            "id": f"device-{device.id}",
            "type": "skill",
            "group": device.manufacturer or 'device',
            "title": name,
            "text": _clip(text),
            "category": device.manufacturer or 'device',
            "importance": min(1.0, 0.42 + min(len(entity_ids), 30) / 60 + min(unavailable, 8) / 12),
            "meta": " · ".join(meta_bits) if meta_bits else f"entities {len(entity_ids)}",
            "device_id": device.id,
            "use_count": len(entity_ids),
            "view_count": unavailable,
        })

    device_nodes.sort(key=lambda item: (item.get('view_count', 0), item.get('use_count', 0), item.get('importance', 0)), reverse=True)
    integration_nodes.sort(key=lambda item: (item.get('view_count', 0), item.get('use_count', 0), item.get('importance', 0)), reverse=True)
    addon_nodes = sorted(addons, key=lambda item: item.get('title', ''))
    entity_nodes.sort(key=lambda item: (item.get('state') == 'unavailable', item.get('importance', 0)), reverse=True)

    unavailable_total = sum(1 for item in entity_nodes if item.get('state') == 'unavailable')
    core_text = (
        f"Home Assistant snapshot with {len(addon_nodes)} add-ons, {len(integration_nodes)} integrations, "
        f"{len(device_nodes)} devices, and {len(entity_nodes)} entities. "
        f"Unavailable entities: {unavailable_total}."
    )

    return {
        "meta": {
            "memory_count": len(addon_nodes),
            "profile_count": len(integration_nodes),
            "fact_count": len(device_nodes),
            "top_skill_count": len(device_nodes),
            "tool_count": len(entity_nodes),
            "entity_count": len(entity_nodes),
            "unavailable_count": unavailable_total,
        },
        "core": {"title": "Home Assistant Fabric", "text": core_text},
        "memories": addon_nodes,
        "profile": integration_nodes,
        "skills": device_nodes[:120],
        "tools": entity_nodes[:500],
    }


class HermesHACloudDataView(HomeAssistantView):
    url = API_URL
    name = "api:hermes_ha_cloud:data"
    requires_auth = True

    def __init__(self, hass) -> None:
        self.hass = hass

    async def get(self, request):
        addons = await _fetch_supervisor_addons(self.hass)
        payload = _build_snapshot(self.hass, addons)
        return web.Response(text=json.dumps(payload, cls=JSONEncoder), content_type="application/json")
