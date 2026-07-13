import argparse, json, zipfile
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--version', required=True)
args = p.parse_args()
root = Path('/config/hermes_ha_cloud_hacs')
zip_path = Path(f'/config/hermes_ha_cloud_hacs_v{args.version}.zip')
manifest = json.loads((root / 'custom_components' / 'hermes_ha_cloud' / 'manifest.json').read_text())
hacs = json.loads((root / 'hacs.json').read_text())
assert manifest['version'] == args.version
assert hacs['filename'] == f'hermes_ha_cloud_hacs_v{args.version}.zip'
assert zip_path.exists()
with zipfile.ZipFile(zip_path) as zf:
    names = set(zf.namelist())
    assert '__init__.py' in names
    assert 'manifest.json' in names
print('OK')
