#!/usr/bin/env bash

# Railway asigna automáticamente el puerto en $PORT
export PORT=${PORT:-5000}

# Ejecuta tu app de Flask en todas las interfaces
python3 pdf-text.py
