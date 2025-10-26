#!/bin/bash

# Deploy script for home automation service
# Connects to bee.local, stops service, pulls latest code, and restarts service

set -e

echo "🚀 Starting deployment to bee.local..."

ssh carlos@bee.local << 'EOF'
    echo "📋 Stopping homeautomation service..."
    sudo -n systemctl stop homeautomation

    echo "📁 Navigating to project directory..."
    cd /home/carlos/homeautomation
    echo "🔄 Pulling latest code from git..."
    git pull origin main

    echo "🔄 Restarting homeautomation service..."
    sudo -n systemctl start homeautomation

    echo "✅ Checking service status..."
    sudo -n systemctl status homeautomation
EOF

echo "✅ Deployment completed successfully!"