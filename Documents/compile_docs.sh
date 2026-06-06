#!/bin/bash
# Pharma-Cure V4 Documentation Build Script
# This script compiles all LaTeX technical specifications and presentation cards.

echo "[BUILD] Initializing Documentation Compiler..."

# Check for pdflatex
if ! command -v pdflatex &> /dev/null
then
    echo "[ERROR] pdflatex could not be found. Please install TeX Live."
    exit
fi

cd "$(dirname "$0")"

echo "[BUILD] Compiling Technical Architecture Specification..."
pdflatex -interaction=nonstopmode system_architecture.tex > /dev/null

echo "[BUILD] Compiling Presentation Briefing Cards..."
pdflatex -interaction=nonstopmode presentation_cards.tex > /dev/null

echo "[BUILD] Cleaning up temporary build files..."
rm -f *.aux *.log *.out *.toc

echo "[SUCCESS] Documentation suite is ready in the Documents/ folder."
echo " - system_architecture.pdf"
echo " - presentation_cards.pdf"
