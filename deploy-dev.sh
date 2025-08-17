#!/bin/bash

# Development deploy script for home automation service
# Connects to bee.local, stops service, copies local files, and restarts service

set -e

echo "🚀 Starting development deployment to bee.local..."

echo "📋 Stopping homeautomation service..."
ssh carlos@bee.local "sudo -n systemctl stop homeautomation"

echo "📁 Copying files to bee.local..."
rsync -av --exclude='.git' --exclude='node_modules' --exclude='deploy*.sh' . carlos@bee.local:/home/carlos/homeautomation/

echo "🔄 Restarting homeautomation service..."
ssh carlos@bee.local "sudo -n systemctl start homeautomation"

echo "✅ Checking service status..."
ssh carlos@bee.local "sudo -n systemctl status homeautomation"

echo "✅ Development deployment completed successfully!"