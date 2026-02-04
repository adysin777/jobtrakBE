#!/bin/bash
# Script to kill Node.js processes running on common backend ports

echo "Finding Node.js processes on ports 3000 and 8080..."

# Find PIDs listening on ports 3000 and 8080
PIDS=$(lsof -ti :3000 -ti :8080 2>/dev/null)

if [ -z "$PIDS" ]; then
    echo "No processes found on ports 3000 or 8080"
    exit 0
fi

echo "Found processes: $PIDS"
echo "Killing processes..."

# Kill the processes
kill -9 $PIDS 2>/dev/null

sleep 1

# Verify they're gone
REMAINING=$(lsof -ti :3000 -ti :8080 2>/dev/null)
if [ -z "$REMAINING" ]; then
    echo "✅ Successfully killed all processes. Ports are now free."
else
    echo "⚠️  Some processes may still be running: $REMAINING"
fi

