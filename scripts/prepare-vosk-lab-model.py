"""Prepare the pinned official model from a local ZIP; no network or build."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile

EXPECTED = '9ec65e75861d1c6c2e457cccd932705340dcdf233f5b239f00733b4de0bf3267'


def prepare(archive, project):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != EXPECTED:
        raise ValueError('Unexpected model archive hash')
    assets = project / 'modules/safemelink-vosk-lab/android/src/enabled/assets'
    target = assets / 'vosk-it'
    assets.mkdir(parents=True, exist_ok=True)
    if target.exists() and (target.is_symlink() or getattr(target.lstat(), 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0)):
        raise ValueError('Model target must not be a link')
    with tempfile.TemporaryDirectory(dir=assets) as temporary:
        stage = Path(temporary)
        with zipfile.ZipFile(archive) as model:
            for item in model.infolist():
                location = (stage / item.filename).resolve()
                if not location.is_relative_to(stage.resolve()) or stat.S_ISLNK(item.external_attr >> 16):
                    raise ValueError('Unsafe model member')
                if not item.filename.startswith('vosk-model-small-it-0.22/'):
                    raise ValueError('Unexpected model root')
            if model.testzip() is not None:
                raise ValueError('Model CRC failed')
            model.extractall(stage)
        source = stage / 'vosk-model-small-it-0.22'
        if not (source / 'am/final.mdl').is_file():
            raise ValueError('Incomplete model')
        inventory = {p.relative_to(source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
        if target.exists():
            actual = {p.relative_to(target).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in target.rglob('*') if p.is_file() and p.name != 'SAFEMELINK_MODEL_SHA256.json'}
            if actual != inventory:
                raise ValueError('Existing model differs; no model files overwritten')
            # Only a verified, generated inventory is refreshed, with portable paths.
            (target / 'SAFEMELINK_MODEL_SHA256.json').write_text(json.dumps(inventory, indent=2, sort_keys=True), encoding='utf-8')
            return target
        (source / 'SAFEMELINK_MODEL_SHA256.json').write_text(json.dumps(inventory, indent=2, sort_keys=True), encoding='utf-8')
        shutil.move(str(source), target)
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    print(prepare(args.archive, args.project))
