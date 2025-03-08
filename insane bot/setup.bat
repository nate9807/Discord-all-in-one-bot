@echo off
echo Do you need to install Node.js? (y/n)
set /p choice="Enter your choice: "

if /i "%choice%"=="y" (
    echo Opening Node.js website...
    start https://nodejs.org/
    echo Please install Node.js and then run this script again
    pause
    exit
) else (
    echo Running npm install...
    npm install
    echo Everything installed!
    echo Please change .env with your info and then run start.bat
    echo Creating start.bat file...
    
    echo @echo off > start.bat
    echo echo Starting bot... >> start.bat
    echo node bot.js >> start.bat
    echo pause >> start.bat
    
    echo Setup complete, this file will now delete itself
    pause
    
    :: Self-deletion command
    (goto) 2>nul & del "%~f0"
)