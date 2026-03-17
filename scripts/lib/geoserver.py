"""GeoServer REST API functions."""

from __future__ import annotations

import time
import xml.etree.ElementTree as ET

import requests


def ensure_workspace(base: str, auth: tuple[str, str], workspace: str) -> None:
    """Ensure GeoServer workspace exists, create if necessary."""
    r = requests.get(f"{base}/rest/workspaces/{workspace}.xml", auth=auth, timeout=60)
    if r.status_code == 200:
        print(f"Workspace OK: {workspace}")
        return
    xml = f"<workspace><name>{workspace}</name></workspace>"
    r = requests.post(
        f"{base}/rest/workspaces",
        auth=auth,
        headers={"Content-Type": "application/xml"},
        data=xml.encode("utf-8"),
        timeout=60,
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Cannot create workspace {workspace}: {r.status_code} {r.text}")
    print(f"Workspace created: {workspace}")


def store_exists(base: str, auth: tuple[str, str], workspace: str, store_name: str) -> bool:
    """Check if coverage store exists in GeoServer."""
    r = requests.get(f"{base}/rest/workspaces/{workspace}/coveragestores/{store_name}.xml", auth=auth, timeout=60)
    return r.status_code == 200


def delete_store_if_exists(base: str, auth: tuple[str, str], workspace: str, store_name: str) -> None:
    """Delete coverage store and layer if they exist (idempotent)."""
    requests.delete(f"{base}/rest/layers/{workspace}:{store_name}", auth=auth, timeout=60)
    requests.delete(
        f"{base}/rest/workspaces/{workspace}/coveragestores/{store_name}?recurse=true&purge=all",
        auth=auth,
        timeout=60,
    )


def wait_store_gone(base: str, auth: tuple[str, str], workspace: str, store_name: str, timeout: int = 90) -> bool:
    """Wait for coverage store to be deleted."""
    end = time.time() + timeout
    url = f"{base}/rest/workspaces/{workspace}/coveragestores/{store_name}.xml"
    while time.time() < end:
        r = requests.get(url, auth=auth, timeout=60)
        if r.status_code == 404:
            return True
        time.sleep(1)
    return False


def upload_zip(
    base: str, auth: tuple[str, str], workspace: str, store_name: str, zip_path: str, configure: str
) -> requests.Response:
    """Upload ImageMosaic ZIP to GeoServer."""
    url = (
        f"{base}/rest/workspaces/{workspace}/coveragestores/"
        f"{store_name}/file.imagemosaic?configure={configure}"
    )
    with open(zip_path, "rb") as f:
        return requests.put(
            url,
            auth=auth,
            headers={"Content-Type": "application/zip"},
            data=f,
            timeout=300,
        )


def reharvest_mosaic(
    base: str, auth: tuple[str, str], workspace: str, store_name: str, mosaic_dir: str
) -> requests.Response:
    """Trigger reharvest of ImageMosaic to pick up new files."""
    url = (
        f"{base}/rest/workspaces/{workspace}/coveragestores/"
        f"{store_name}/external.imagemosaic?recalculate=nativebbox,latlonbbox"
    )
    r = requests.post(
        url,
        auth=auth,
        headers={"Content-Type": "text/plain"},
        data=mosaic_dir,
        timeout=300,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"Reharvest failed (HTTP {r.status_code}): {r.text}")
    return r


def wait_coverages(base: str, auth: tuple[str, str], workspace: str, store_name: str, timeout: int = 90) -> list[str]:
    """Wait for coverages to appear in store after upload."""
    url = f"{base}/rest/workspaces/{workspace}/coveragestores/{store_name}/coverages.xml"
    end = time.time() + timeout
    while time.time() < end:
        r = requests.get(url, auth=auth, timeout=60)
        if r.status_code == 200 and "<coverage>" in r.text:
            root = ET.fromstring(r.text)
            covs = [n.text for n in root.findall(".//coverage/name") if n.text]
            if covs:
                return covs
        time.sleep(1)
    return []


def set_default_style(base: str, auth: tuple[str, str], workspace: str, layer_name: str, style_name: str) -> None:
    """Set default style for a layer."""
    if not style_name:
        return
    xml = f"<layer><defaultStyle><name>{style_name}</name></defaultStyle></layer>"
    r = requests.put(
        f"{base}/rest/layers/{workspace}:{layer_name}",
        auth=auth,
        headers={"Content-Type": "application/xml"},
        data=xml.encode("utf-8"),
        timeout=60,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"Set style failed (HTTP {r.status_code}): {r.text}")


def enable_time_dim(base: str, auth: tuple[str, str], workspace: str, store_name: str, coverage_name: str) -> None:
    """Enable TIME dimension for a coverage (no elevation)."""
    xml = f"""<coverage>
  <name>{coverage_name}</name>
  <enabled>true</enabled>
  <metadata>
    <entry key="time">
      <dimensionInfo>
        <enabled>true</enabled>
        <presentation>DISCRETE_INTERVAL</presentation>
        <units>ISO8601</units>
        <defaultValue><strategy>MAXIMUM</strategy></defaultValue>
      </dimensionInfo>
    </entry>
  </metadata>
</coverage>"""
    url = f"{base}/rest/workspaces/{workspace}/coveragestores/{store_name}/coverages/{coverage_name}"
    r = requests.put(url, auth=auth, headers={"Content-Type": "application/xml"}, data=xml.encode("utf-8"), timeout=60)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Enable time failed (HTTP {r.status_code}): {r.text}")


def enable_time_and_elevation_dims(
    base: str, auth: tuple[str, str], workspace: str, store_name: str, coverage_name: str
) -> None:
    """Enable TIME and ELEVATION dimensions for a coverage."""
    xml = f"""<coverage>
  <name>{coverage_name}</name>
  <enabled>true</enabled>
  <metadata>
    <entry key="time">
      <dimensionInfo>
        <enabled>true</enabled>
        <presentation>DISCRETE_INTERVAL</presentation>
        <units>ISO8601</units>
        <defaultValue><strategy>MAXIMUM</strategy></defaultValue>
      </dimensionInfo>
    </entry>
    <entry key="elevation">
      <dimensionInfo>
        <enabled>true</enabled>
        <presentation>LIST</presentation>
        <units>1</units>
      </dimensionInfo>
    </entry>
  </metadata>
</coverage>"""
    url = f"{base}/rest/workspaces/{workspace}/coveragestores/{store_name}/coverages/{coverage_name}"
    r = requests.put(url, auth=auth, headers={"Content-Type": "application/xml"}, data=xml.encode("utf-8"), timeout=60)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Enable time/elevation failed (HTTP {r.status_code}): {r.text}")
