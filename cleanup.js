const fs = require('fs');
const path = require('path');

function deleteDotFiles(directory) {
  const files = fs.readdirSync(directory);
  
  files.forEach(file => {
    const fullPath = path.join(directory, file);
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      deleteDotFiles(fullPath);
    } else if (file.startsWith('._')) {
      console.log(`Deleting: ${fullPath}`);
      fs.unlinkSync(fullPath);
    }
  });
}

try {
  console.log('Starting cleanup...');
  deleteDotFiles('.');
  console.log('Cleanup complete!');
} catch (err) {
  console.error('Error during cleanup:', err);
}