#!/bin/bash
# Setup script for creating virtual environment on server
# Run this on your server: bash setup_venv.sh

set -e  # Exit on error

echo "=== Setting up Python virtual environment for WMS scripts ==="

# Check Python version
python3 --version

# Create virtual environment
echo "Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install requirements
echo "Installing required packages..."
pip install -r requirements.txt

echo "=== Setup complete! ==="
echo ""
echo "To activate the virtual environment, run:"
echo "  source venv/bin/activate"
echo ""
echo "To run the scripts:"
echo "  python time_series_video_WMS.py"
echo "  python time_series_static_WMS.py"
echo "  python time_series_points_WMS.py"
echo ""
echo "To deactivate the virtual environment, run:"
echo "  deactivate"
