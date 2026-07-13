from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from typing import Any

from aiohttp import web
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.area_registry import async_get as async_get_area_registry
from homeassistant.helpers.device_registry import async_get as async_get_device_registry
from homeassistant.helpers.entity_registry import async_get as async_get_entity_registry
from homeassistant.helpers.http import HomeAssistantView
from homeassistant.helpers.json import JSONEncoder

from .const import API_URL

IGNORE_DOMAINS = {"hermes_mind_cloud", "hermes_ha_cloud"}
IGNORE_ENTITY_PREFIXES = (
    "sensor.tapo_c220_",
    "binary_sensor.tapo_c220_",
    "switch.tapo_c220_",
    "light.tapo_c220_",
    "camera.tapo_c220_",
)
ACTIVE_STATES = {"on", "home", "playing", "open", "armed_home", "armed_away", "triggered"}
PROBLEM_STATES = {"unavailable", "unknown"}


def _state_obj(hass, entity_id: str):
    return hass.states.get(entity_id)


def _clip(text: str, size: int = 220) -> str:
    text = (text or "").strip()
    return text if len(text) <= size else text[: size - 1] + "…"


def _importance_from_state(state: str, unavailable: bool = False, extra: float = 0.0) -> float:
    if unavailable:
        return min(1.0, 0.94 + extra)
    if state in ACTIVE_STATES:
        return min(1.0, 0.7 + extra)
    return min(1.0, 0.46 + extra)


def _severity_from_counts(unavailable: int, total: int) -> str:
    if unavailable <= 0:
        return "ok"
    if unavailable >= max(2, total // 2):
        return "critical"
    return "warning"


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

    out = []
    for addon in payload.get("data", {}).get("addons", []):
        slug = addon.get("slug") or addon.get("name") or "addon"
        state = addon.get("state") or "unknown"
        started = state == "started"
        out.append(
            {
                "id": f"addon-{slug}",
                "layer": "addon",
                "type": "addon",
                "group": "addon",
                "title": addon.get("name") or slug,
                "text": _clip(addon.get("description") or f"Add-on state: {state}"),
                "category": addon.get("repository") or slug,
                "importance": 0.9 if started else 0.68,
                "severity": "ok" if started else "warning",
                "meta": f"state {state}",
                "state": state,
                "slug": slug,
            }
        )
    return out


def _extract_scene_entities(state_obj) -> list[str]:
    if not state_obj:
        return []
    attr = state_obj.attributes.get("entity_id")
    if isinstance(attr, list):
        return [x for x in attr if isinstance(x, str)]
    return []


def _extract_automation_entities(state_obj) -> list[str]:
    if not state_obj:
        return []
    attr = state_obj.attributes
    refs: set[str] = set()
    for key in ("entity_id", "entities"):
        value = attr.get(key)
        if isinstance(value, list):
            refs.update(x for x in value if isinstance(x, str))
        elif isinstance(value, str) and "." in value:
            refs.add(value)
    for value in attr.values():
        if isinstance(value, str) and "." in value:
            refs.add(value)
        elif isinstance(value, list):
            refs.update(x for x in value if isinstance(x, str) and "." in x)
    return sorted(refs)


def _build_snapshot(hass, addons: list[dict[str, Any]]) -> dict[str, Any]:
    er = async_get_entity_registry(hass)
    dr = async_get_device_registry(hass)
    ar = async_get_area_registry(hass)
    entries = [e for e in hass.config_entries.async_entries() if e.domain not in IGNORE_DOMAINS]

    entities_by_config = defaultdict(list)
    entities_by_device = defaultdict(list)
    entities_by_area = defaultdict(list)
    devices_by_config = defaultdict(set)
    devices_by_area = defaultdict(set)
    unavailable_counts_by_device = Counter()
    unavailable_counts_by_area = Counter()
    domain_counts_by_device = defaultdict(Counter)
    node_by_id: dict[str, dict[str, Any]] = {}
    links: list[dict[str, Any]] = []
    seen_links: set[tuple[str, str, str]] = set()

    def add_link(source: str | None, target: str | None, relation: str, weight: float = 1.0):
        if not source or not target or source == target:
            return
        key = (source, target, relation)
        if key in seen_links:
            return
        seen_links.add(key)
        links.append({"source": source, "target": target, "relation": relation, "weight": weight})

    entity_nodes = []
    person_nodes = []
    automation_nodes = []
    scene_nodes = []

    for entity in er.entities.values():
        if any(entity.entity_id.startswith(prefix) for prefix in IGNORE_ENTITY_PREFIXES):
            continue
        state_obj = _state_obj(hass, entity.entity_id)
        state = state_obj.state if state_obj else "unknown"
        is_unavailable = state == "unavailable"
        domain = entity.entity_id.split(".", 1)[0]
        label = entity.original_name or entity.name or entity.entity_id
        area_id = getattr(entity, "area_id", None)
        device_id = getattr(entity, "device_id", None)
        layer = "entity"
        if domain == "automation":
            layer = "automation"
        elif domain == "scene":
            layer = "scene"
        elif domain == "person":
            layer = "person"

        if entity.config_entry_id:
            entities_by_config[entity.config_entry_id].append(entity.entity_id)
        if device_id:
            entities_by_device[device_id].append(entity.entity_id)
            domain_counts_by_device[device_id][domain] += 1
            if entity.config_entry_id:
                devices_by_config[entity.config_entry_id].add(device_id)
            if is_unavailable:
                unavailable_counts_by_device[device_id] += 1
        if area_id:
            entities_by_area[area_id].append(entity.entity_id)
            if device_id:
                devices_by_area[area_id].add(device_id)
            if is_unavailable:
                unavailable_counts_by_area[area_id] += 1

        importance = _importance_from_state(state, unavailable=is_unavailable, extra=0.04 if layer != "entity" else 0.0)
        item = {
            "id": f"{layer}-{entity.entity_id}",
            "layer": layer,
            "type": layer,
            "group": domain,
            "title": label,
            "text": _clip(f"{entity.entity_id} · state {state}"),
            "category": domain,
            "importance": importance,
            "severity": "critical" if is_unavailable else ("active" if state in ACTIVE_STATES else "ok"),
            "meta": f"state {state}" + (f" · area {area_id}" if area_id else ""),
            "entity_id": entity.entity_id,
            "state": state,
            "device_id": device_id,
            "area_id": area_id,
            "config_entry_id": entity.config_entry_id,
        }
        node_by_id[item["id"]] = item

        if layer == "entity":
            entity_nodes.append(item)
        elif layer == "person":
            person_nodes.append(item)
        elif layer == "automation":
            item["related_entity_ids"] = _extract_automation_entities(state_obj)
            automation_nodes.append(item)
        elif layer == "scene":
            item["related_entity_ids"] = _extract_scene_entities(state_obj)
            scene_nodes.append(item)

    integration_nodes = []
    for entry in entries:
        ent_ids = entities_by_config.get(entry.entry_id, [])
        unavailable = sum(1 for eid in ent_ids if (_state_obj(hass, eid) and _state_obj(hass, eid).state == "unavailable"))
        device_ids = sorted(devices_by_config.get(entry.entry_id, set()))
        title = entry.title or entry.domain
        meta = [f"domain {entry.domain}", f"entities {len(ent_ids)}", f"devices {len(device_ids)}", f"state {entry.state}"]
        if unavailable:
            meta.append(f"unavailable {unavailable}")
        item = {
            "id": f"integration-{entry.entry_id}",
            "layer": "integration",
            "type": "integration",
            "group": entry.domain,
            "title": title,
            "text": _clip(f"Integration domain {entry.domain}. Entities: {len(ent_ids)}. Devices: {len(device_ids)}."),
            "category": entry.domain,
            "importance": min(1.0, 0.54 + min(len(ent_ids), 40) / 90 + min(unavailable, 10) / 15),
            "severity": _severity_from_counts(unavailable, max(len(ent_ids), 1)),
            "meta": " · ".join(meta),
            "entry_id": entry.entry_id,
            "state": str(entry.state),
            "use_count": len(ent_ids),
            "view_count": unavailable,
            "related_entity_ids": ent_ids[:80],
            "related_device_ids": device_ids[:60],
        }
        integration_nodes.append(item)
        node_by_id[item["id"]] = item

    area_nodes = []
    for area in ar.areas.values():
        entity_ids = entities_by_area.get(area.id, [])
        device_ids = sorted(devices_by_area.get(area.id, set()))
        unavailable = unavailable_counts_by_area.get(area.id, 0)
        if not entity_ids and not device_ids:
            continue
        item = {
            "id": f"area-{area.id}",
            "layer": "area",
            "type": "area",
            "group": "area",
            "title": area.name,
            "text": _clip(f"{len(device_ids)} devices · {len(entity_ids)} entities" + (f" · {unavailable} unavailable" if unavailable else "")),
            "category": "area",
            "importance": min(1.0, 0.52 + min(len(device_ids), 20) / 50 + min(unavailable, 8) / 12),
            "severity": _severity_from_counts(unavailable, max(len(entity_ids), 1)),
            "meta": f"devices {len(device_ids)} · entities {len(entity_ids)}" + (f" · unavailable {unavailable}" if unavailable else ""),
            "area_id": area.id,
            "use_count": len(device_ids),
            "view_count": unavailable,
            "related_entity_ids": entity_ids[:120],
            "related_device_ids": device_ids[:80],
        }
        area_nodes.append(item)
        node_by_id[item["id"]] = item

    device_nodes = []
    problem_nodes = []
    for device in dr.devices.values():
        entity_ids = entities_by_device.get(device.id, [])
        if not entity_ids:
            continue
        name = device.name_by_user or device.name or next(iter(device.identifiers), ("device", "device"))[-1]
        unavailable = unavailable_counts_by_device.get(device.id, 0)
        manufacturers = [x for x in [device.manufacturer, device.model] if x]
        domains = ", ".join(f"{k}:{v}" for k, v in domain_counts_by_device.get(device.id, {}).most_common(4))
        area_id = getattr(device, "area_id", None)
        entry_ids = sorted({er.entities[eid].config_entry_id for eid in entity_ids if eid in er.entities and er.entities[eid].config_entry_id})
        item = {
            "id": f"device-{device.id}",
            "layer": "device",
            "type": "device",
            "group": device.manufacturer or "device",
            "title": name,
            "text": _clip(f"{len(entity_ids)} entities" + (f", {unavailable} unavailable" if unavailable else "")),
            "category": device.manufacturer or "device",
            "importance": min(1.0, 0.46 + min(len(entity_ids), 30) / 65 + min(unavailable, 8) / 10),
            "severity": _severity_from_counts(unavailable, max(len(entity_ids), 1)),
            "meta": " · ".join(x for x in [" / ".join(manufacturers) if manufacturers else "", f"area {area_id}" if area_id else "", domains] if x),
            "device_id": device.id,
            "area_id": area_id,
            "use_count": len(entity_ids),
            "view_count": unavailable,
            "related_entity_ids": entity_ids[:120],
            "related_config_entry_ids": entry_ids[:20],
        }
        device_nodes.append(item)
        node_by_id[item["id"]] = item

        if unavailable:
            problem = {
                "id": f"problem-{device.id}",
                "layer": "problem",
                "type": "problem",
                "group": device.manufacturer or "problem",
                "title": name,
                "text": _clip(f"Device issue: {unavailable} unavailable of {len(entity_ids)} entities"),
                "category": "device_problem",
                "importance": min(1.0, 0.88 + min(unavailable, 6) / 20),
                "severity": "critical" if unavailable >= 2 else "warning",
                "meta": f"unavailable {unavailable} / {len(entity_ids)}" + (f" · area {area_id}" if area_id else ""),
                "device_id": device.id,
                "area_id": area_id,
                "use_count": len(entity_ids),
                "view_count": unavailable,
                "related_entity_ids": [eid for eid in entity_ids if (_state_obj(hass, eid) and _state_obj(hass, eid).state == "unavailable")][:80],
            }
            problem_nodes.append(problem)
            node_by_id[problem["id"]] = problem

    # explicit links
    for node in integration_nodes:
        for eid in node.get("related_entity_ids", []):
            add_link(node["id"], f"entity-{eid}" if not eid.startswith("person.") and not eid.startswith("automation.") and not eid.startswith("scene.") else f"{eid.split('.',1)[0]}-{eid}", "integrates", 0.9)
        for did in node.get("related_device_ids", []):
            add_link(node["id"], f"device-{did}", "supports", 0.7)

    for node in device_nodes:
        for eid in node.get("related_entity_ids", []):
            add_link(node["id"], f"entity-{eid}" if not eid.startswith("person.") and not eid.startswith("automation.") and not eid.startswith("scene.") else f"{eid.split('.',1)[0]}-{eid}", "contains", 1.0)
        for entry_id in node.get("related_config_entry_ids", []):
            add_link(f"integration-{entry_id}", node["id"], "owns", 0.8)
        if node.get("area_id"):
            add_link(f"area-{node['area_id']}", node["id"], "located", 0.95)

    for node in area_nodes:
        for eid in node.get("related_entity_ids", []):
            layer = eid.split(".", 1)[0]
            target = f"entity-{eid}"
            if layer in {"person", "automation", "scene"}:
                target = f"{layer}-{eid}"
            add_link(node["id"], target, "covers", 0.6)
        for did in node.get("related_device_ids", []):
            add_link(node["id"], f"device-{did}", "hosts", 0.95)

    for node in automation_nodes + scene_nodes:
        for eid in node.get("related_entity_ids", []):
            layer = eid.split(".", 1)[0]
            target = f"entity-{eid}"
            if layer in {"person", "automation", "scene"}:
                target = f"{layer}-{eid}"
            add_link(node["id"], target, "targets", 1.0)
            entity = er.entities.get(eid)
            if entity and getattr(entity, "device_id", None):
                add_link(node["id"], f"device-{entity.device_id}", "affects", 0.7)
            if entity and getattr(entity, "area_id", None):
                add_link(node["id"], f"area-{entity.area_id}", "runs_in", 0.65)

    for node in person_nodes:
        for area_node in area_nodes:
            if node.get("state") == "home" and area_node["title"].lower() in (node["title"] or "").lower():
                add_link(node["id"], area_node["id"], "near", 0.4)

    for node in problem_nodes:
        add_link(node["id"], f"device-{node['device_id']}", "alerts", 1.0)
        if node.get("area_id"):
            add_link(node["id"], f"area-{node['area_id']}", "in_area", 0.8)
        for eid in node.get("related_entity_ids", []):
            add_link(node["id"], f"entity-{eid}", "broken", 1.0)

    addon_nodes = sorted(addons, key=lambda item: item.get("title", ""))
    for addon in addon_nodes:
        node_by_id[addon["id"]] = addon

    for items in (integration_nodes, area_nodes, device_nodes, entity_nodes, automation_nodes, scene_nodes, person_nodes, problem_nodes):
        items.sort(key=lambda item: (item.get("view_count", 0), item.get("use_count", 0), item.get("importance", 0)), reverse=True)

    unavailable_total = sum(1 for item in entity_nodes if item.get("state") == "unavailable")
    core_text = (
        f"Home Assistant snapshot with {len(addon_nodes)} add-ons, {len(integration_nodes)} integrations, "
        f"{len(area_nodes)} areas, {len(device_nodes)} devices, {len(entity_nodes)} entities, "
        f"{len(automation_nodes)} automations, {len(scene_nodes)} scenes, and {len(person_nodes)} persons. "
        f"Unavailable entities: {unavailable_total}. Problem devices: {len(problem_nodes)}."
    )

    return {
        "meta": {
            "addon_count": len(addon_nodes),
            "integration_count": len(integration_nodes),
            "area_count": len(area_nodes),
            "device_count": len(device_nodes),
            "entity_count": len(entity_nodes),
            "automation_count": len(automation_nodes),
            "scene_count": len(scene_nodes),
            "person_count": len(person_nodes),
            "problem_device_count": len(problem_nodes),
            "unavailable_count": unavailable_total,
            "link_count": len(links),
            "memory_count": len(addon_nodes),
            "profile_count": len(integration_nodes),
            "fact_count": len(device_nodes),
            "tool_count": len(entity_nodes),
            "top_skill_count": len(problem_nodes) or len(device_nodes),
        },
        "core": {"title": "Home Assistant Fabric", "text": core_text},
        "addons": addon_nodes,
        "integrations": integration_nodes,
        "areas": area_nodes,
        "devices": device_nodes[:180],
        "entities": entity_nodes[:700],
        "automations": automation_nodes[:180],
        "scenes": scene_nodes[:120],
        "persons": person_nodes[:60],
        "problem_devices": problem_nodes[:120],
        "links": links[:5000],
        "memories": addon_nodes,
        "profile": integration_nodes,
        "skills": device_nodes[:180],
        "tools": entity_nodes[:700],
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
