const fs = require('fs');
const AdmZip = require('adm-zip');

function extractZip(filename) {
  try {
    console.log(`Extracting ${filename}...`);
    const zip = new AdmZip(filename);
    zip.extractAllTo('./', true);
    console.log(`${filename} extraction complete`);
  } catch (err) {
    console.error(`Error during ${filename} extraction:`, err);
  }
}

// Extract both zip files
extractZip('Archive.zip');
extractZip('Immagini.zip');