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
echo "4) Recreate last release (delete and re-push last tag)"
read -p "Enter your choice (1-4): " choice

case $choice in
  1) new_version=$(increment_version $current_version 0);;
  2) new_version=$(increment_version $current_version 1);;
  3) new_version=$(increment_version $current_version 2);;
  4)
    # Get the latest tag
    new_version=$(git describe --tags --abbrev=0 2>/dev/null)
    if [ -z "$new_version" ]; then
      echo "No tags found. Exiting."
      exit 1
    fi
    # Remove 'v' prefix if present for consistency
    new_version=${new_version#v}
    echo "Recreating release for version: $new_version"
    ;;
  *) echo "Invalid choice. Exiting."; exit 1;;
esac

# For option 4, we need to delete the remote tag first
if [ "$choice" == "4" ]; then
  # Check if tag exists and delete it
  tag_name="v$new_version"
  echo "Deleting tag $tag_name..."

  # Delete local tag
  if git rev-parse "$tag_name" >/dev/null 2>&1; then
    git tag -d "$tag_name"
  fi

  # Delete remote tag
  if git ls-remote --tags origin | grep -q "refs/tags/$tag_name"; then
    git push origin ":refs/tags/$tag_name"
  fi
fi

echo "New version will be: $new_version"

# Update package.json using Node.js (cross-platform)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
pkg.version = '$new_version';
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');
"

# Commit changes
git add package.json
git commit -m "Bump version to $new_version"

# Create and push tag
git tag -a "v$new_version" -m "Release version $new_version"
git push && git push --tags

echo "Version updated to $new_version, changes committed, and tag pushed."