"""NetCDF processing utilities."""

from __future__ import annotations

import re

import xarray as xr


def parse_issue_dt_12_from_nc(filename: str) -> str:
    """Extract 12-digit timestamp (YYYYMMDDHHMM) from NetCDF filename."""
    m = re.search(r"_(\d{12})-", filename)
    if m:
        return m.group(1)
    m = re.search(r"(\d{12})", filename)
    if m:
        return m.group(1)
    # Fallback to 8-digit pattern
    m = re.search(r"_(\d{8})", filename)
    if m:
        return m.group(1) + "0000"
    raise RuntimeError(f"Cannot parse date from NC name: {filename}")


def yyyymmddhhmm_to_iso(dt12: str) -> str:
    """Convert YYYYMMDDHHMM to ISO 8601 format."""
    if len(dt12) == 8:
        dt12 = dt12 + "0000"
    return f"{dt12[0:4]}-{dt12[4:6]}-{dt12[6:8]}T{dt12[8:10]}:{dt12[10:12]}:00Z"


def ensure_lat_lon(da: xr.DataArray) -> xr.DataArray:
    """Ensure proper lat/lon dimensions for regular raster data."""
    if "latitude" in da.dims and "longitude" in da.dims:
        da = da.transpose("latitude", "longitude")
        da = da.sortby("latitude", ascending=False)
        da.rio.set_spatial_dims(x_dim="longitude", y_dim="latitude", inplace=True)
    elif "lat" in da.dims and "lon" in da.dims:
        da = da.transpose("lat", "lon")
        da = da.sortby("lat", ascending=False)
        da.rio.set_spatial_dims(x_dim="lon", y_dim="lat", inplace=True)
    else:
        raise RuntimeError(f"Unknown spatial dims: {da.dims}")
    da.rio.write_crs("EPSG:4326", inplace=True)
    return da


def ensure_lat_lon_da(da: xr.DataArray) -> xr.DataArray:
    """Ensure proper lat/lon dimensions for coastal point data."""
    da = da.transpose("lat", "lon")
    da = da.sortby("lat", ascending=False)
    da.rio.set_spatial_dims(x_dim="lon", y_dim="lat", inplace=True)
    da = da.rio.write_crs("EPSG:4326", inplace=True)
    return da
