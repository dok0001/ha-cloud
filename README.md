# Hermes HA Cloud

HACS-compatible Home Assistant custom integration that adds a sidebar panel visualizing your **add-ons, integrations, devices, and entities** in a cinematic cloud similar to Hermes Mind Cloud.

## Local structure
- Live component: `/config/custom_components/hermes_ha_cloud`
- HACS mirror repo: `/config/hermes_ha_cloud_hacs`

## What it shows
- **Add-ons** in the first lane
- **Integrations** in the second lane
- **Devices** in the third lane
- **Entities** in the fourth lane

Tapo C220 entity rows are intentionally filtered from the entity lane to match the current local troubleshooting preference. This can be made configurable later.

## Install via HACS repo
1. Create your GitHub repo.
2. Push the contents of this mirror repo.
3. Add the repo as a custom HACS repository.
4. Install **Hermes HA Cloud**.
5. Add the integration from Devices & Services.

## Notes
- The panel reuses the proven Hermes Mind Cloud frontend structure but points at Home Assistant data instead of Hermes memory data.
- Add-on listing uses the Supervisor API when available and otherwise degrades gracefully.
