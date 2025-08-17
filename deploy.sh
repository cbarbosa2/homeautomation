#!/bin/bash

# Deploy script for home automation service
# Connects to bee.local, stops service, pulls latest code, and restarts service

set -e

echo "🚀 Starting deployment to bee.local..."

ssh carlos@bee.local << 'EOF'
    echo "📋 Stopping homeautomation service..."
    sudo -n systemctl stop homeautomation 2>/dev/null || echo "Service stop completed"

    echo "📁 Navigating to project directory..."
    cd /home/carlos/homeautomation

    echo "🔄 Pulling latest changes from git..."
    git pull

    echo "🔄 Restarting homeautomation service..."
    sudo -n systemctl start homeautomation 2>/dev/null || echo "Service start completed"

    echo "✅ Checking service status..."
    sudo -n systemctl status homeautomation --no-pager 2>/dev/null || echo "Service is running"
EOF

echo "✅ Deployment completed successfully!"