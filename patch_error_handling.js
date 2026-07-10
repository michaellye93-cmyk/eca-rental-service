import fs from 'fs';
let content = fs.readFileSync('./App.tsx', 'utf8');

// Throw the error in handleUpdateDriver instead of just alerting and resolving
content = content.replace(
  'const { error } = await supabase.from(\'drivers\').update(dbUpdate).eq(\'id\', updatedDriver.id);\n      if (error) throw error;\n      await fetchDriversAndPayments(true);\n    } catch (err: any) {\n      alert(`Error updating driver: ${err.message}`);\n    }',
  'const { error } = await supabase.from(\'drivers\').update(dbUpdate).eq(\'id\', updatedDriver.id);\n      if (error) throw error;\n      await fetchDriversAndPayments(true);\n    } catch (err: any) {\n      alert(`Error updating driver: ${err.message}`);\n      throw err;\n    }'
);

fs.writeFileSync('./App.tsx', content);
