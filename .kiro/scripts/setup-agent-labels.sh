#!/bin/bash
# Setup Agent Labels in GitHub Repository
# Run this once to create color-coded agent labels

set -e

REPO="coralst/valentin-romantic-agent"

echo "🎨 Creating agent labels in $REPO..."

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Install it first:"
    echo "   brew install gh"
    echo "   or visit https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub. Run:"
    echo "   gh auth login"
    exit 1
fi

echo "Creating agent labels..."

# Create agent labels with colors
gh label create "agent: master" \
    --repo "$REPO" \
    --color "7B68EE" \
    --description "👔 Master Agent work" \
    --force 2>/dev/null || echo "  ✓ agent: master (already exists)"

gh label create "agent: architect" \
    --repo "$REPO" \
    --color "FF8C00" \
    --description "🏗️ System Architect work" \
    --force 2>/dev/null || echo "  ✓ agent: architect (already exists)"

gh label create "agent: frontend" \
    --repo "$REPO" \
    --color "1E90FF" \
    --description "⚛️ Frontend Dev work" \
    --force 2>/dev/null || echo "  ✓ agent: frontend (already exists)"

gh label create "agent: backend" \
    --repo "$REPO" \
    --color "32CD32" \
    --description "🔧 Backend Dev work" \
    --force 2>/dev/null || echo "  ✓ agent: backend (already exists)"

gh label create "agent: design" \
    --repo "$REPO" \
    --color "FF69B4" \
    --description "🎨 UI Designer work" \
    --force 2>/dev/null || echo "  ✓ agent: design (already exists)"

gh label create "agent: qa" \
    --repo "$REPO" \
    --color "FF4500" \
    --description "🧪 QA Agent work" \
    --force 2>/dev/null || echo "  ✓ agent: qa (already exists)"

echo ""
echo "✅ All agent labels created!"
echo ""
echo "View labels at: https://github.com/$REPO/labels"
echo ""
echo "Next steps:"
echo "  1. Update branch naming to use agent prefixes (e.g., feat/frontend-feature-name)"
echo "  2. Apply agent labels to PRs when creating them"
echo "  3. View the network graph with color-coded branches"
echo ""
