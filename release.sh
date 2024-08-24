#!/bin/bash

# Function to increment version
increment_version() {
  local version=$1
  local position=$2
  IFS='.' read -ra parts <<< "$version"
  
  if [ $position -eq 0 ]; then
    ((parts[0]++))
    parts[1]=0
    parts[2]=0
  elif [ $position -eq 1 ]; then
    ((parts[1]++))
    parts[2]=0
  elif [ $position -eq 2 ]; then
    ((parts[2]++))
  fi

  echo "${parts[0]}.${parts[1]}.${parts[2]}"
}

# Get current version from package.json
current_version=$(node -p "require('./package.json').version")
echo "Current version: $current_version"

# Ask user which part of the version to increment
echo "Which part of the version do you want to increment?"
echo "1) Major (x.0.0)"
echo "2) Minor (0.x.0)"
echo "3) Patch (0.0.x)"
read -p "Enter your choice (1-3): " choice

case $choice in
  1) new_version=$(increment_version $current_version 0);;
  2) new_version=$(increment_version $current_version 1);;
  3) new_version=$(increment_version $current_version 2);;
  *) echo "Invalid choice. Exiting."; exit 1;;
esac

echo "New version will be: $new_version"
read -p "Do you want to proceed? (y/n): " confirm

if [ "$confirm" != "y" ]; then
  echo "Operation cancelled. Exiting."
  exit 0
fi

# Update package.json
sed -i '' "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" package.json

# Commit changes
git add package.json
git commit -m "Bump version to $new_version"

# Create and push tag
git tag -a "v$new_version" -m "Release version $new_version"
git push && git push --tags

echo "Version updated to $new_version, changes committed, and tag pushed."