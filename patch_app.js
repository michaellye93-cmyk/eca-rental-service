import fs from 'fs';
let content = fs.readFileSync('./App.tsx', 'utf8');

// Add address to formattedDrivers mapping
content = content.replace(
  'name: d.name,\n            carPlate: d.car_plate,',
  'name: d.name,\n            address: d.address,\n            carPlate: d.car_plate,'
);

// Add address to dbDriver in handleCreateDriver
content = content.replace(
  'name: newDriver.name,\n        // contact_number removed\n        car_plate: newDriver.carPlate,',
  'name: newDriver.name,\n        address: newDriver.address || null,\n        // contact_number removed\n        car_plate: newDriver.carPlate,'
);

// Add address to dbUpdate in handleUpdateDriver
content = content.replace(
  'name: updatedDriver.name,\n        // contact_number removed\n        car_plate: updatedDriver.carPlate,',
  'name: updatedDriver.name,\n        address: updatedDriver.address || null,\n        // contact_number removed\n        car_plate: updatedDriver.carPlate,'
);

fs.writeFileSync('./App.tsx', content);
