const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

// Function to repair settings file
async function repairSettingsFile(settingsFile) {
    if (!settingsFile) {
        return { success: false, message: 'Settings file path not configured' };
    }
    
    try {
        // Check if file exists
        const exists = await fs.access(settingsFile)
            .then(() => true)
            .catch(() => false);
            
        if (!exists) {
            // Create empty settings file
            await fs.writeFile(settingsFile, '{}', 'utf8');
            return { success: true, message: 'Created new empty settings file' };
        }
        
        // Read the file content
        const data = await fs.readFile(settingsFile, 'utf8');
        
        // Handle empty files
        if (!data.trim()) {
            await fs.writeFile(settingsFile, '{}', 'utf8');
            return { success: true, message: 'Settings file was empty, created new settings' };
        }
        
        // Check if it's valid JSON
        try {
            JSON.parse(data);
            return { success: true, message: 'Settings file is valid, no repair needed' };
        } catch (parseError) {
            // Back up corrupted file
            const backupPath = `${settingsFile}.repair.${Date.now()}`;
            await fs.writeFile(backupPath, data, 'utf8');
            
            // Try to recover by finding the last complete object
            let recoveredData = '{}';
            if (data.trim().startsWith('{')) {
                let openBrackets = 0;
                let lastValidIndex = -1;
                
                // Find the last properly closed bracket
                for (let i = 0; i < data.length; i++) {
                    if (data[i] === '{') openBrackets++;
                    else if (data[i] === '}') openBrackets--;
                    
                    if (openBrackets === 0) lastValidIndex = i;
                }
                
                if (lastValidIndex > 0) {
                    recoveredData = data.substring(0, lastValidIndex + 1);
                    try {
                        // Verify recovered data
                        const settings = JSON.parse(recoveredData);
                        const keyCount = Object.keys(settings).length;
                        await fs.writeFile(settingsFile, recoveredData, 'utf8');
                        return { 
                            success: true, 
                            message: `Repaired settings file with ${keyCount} entries. Backup created at ${backupPath}` 
                        };
                    } catch {
                        // If still invalid, use empty object
                        recoveredData = '{}';
                    }
                }
            }
            
            // Save empty object as last resort
            await fs.writeFile(settingsFile, recoveredData, 'utf8');
            return { 
                success: true, 
                message: `Could not recover data, reset to empty settings. Backup created at ${backupPath}` 
            };
        }
    } catch (error) {
        return { success: false, message: `Error repairing settings: ${error.message}` };
    }
}

module.exports = {
    name: 'repairsettings',
    data: new SlashCommandBuilder()
        .setName('repairsettings')
        .setDescription('Repairs the bot settings file if it becomes corrupted')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
    async execute(interaction, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: 'You need Administrator permissions to use this command!', 
                ephemeral: true
            });
        }
        
        await interaction.deferReply();
        
        try {
            const settingsFile = process.env.ABSOLUTE_SETTINGS_PATH;
            
            if (!settingsFile) {
                return interaction.editReply('❌ Settings file path not configured in environment variables.');
            }
            
            logger.info(`User ${interaction.user.tag} (${interaction.user.id}) initiated settings repair`);
            
            const result = await repairSettingsFile(settingsFile);
            
            if (result.success) {
                // Reload settings into memory
                try {
                    client.settings.clear();
                    const data = await fs.readFile(settingsFile, 'utf8');
                    const settingsData = JSON.parse(data);
                    
                    for (const [key, value] of Object.entries(settingsData)) {
                        client.settings.set(key, value);
                    }
                    
                    const settingsCount = client.settings.size;
                    return interaction.editReply(`✅ ${result.message}\n\nReloaded ${settingsCount} settings into memory.`);
                } catch (reloadError) {
                    return interaction.editReply(`⚠️ ${result.message}\n\nBut failed to reload settings: ${reloadError.message}`);
                }
            } else {
                return interaction.editReply(`❌ ${result.message}`);
            }
        } catch (error) {
            logger.error(`Error in repairsettings command:`, error);
            return interaction.editReply(`❌ An error occurred: ${error.message}`);
        }
    }
}; 