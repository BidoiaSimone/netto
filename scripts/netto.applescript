-- netto launcher: starts the server (if needed) and opens the netto window, then quits.
--
-- How the pieces fit:
--   1. This launcher runs launch.sh start: it starts the server and opens netto.
--   2. netto opens as a standalone Safari web app (its own window and Dock icon, no browser toolbar),
--      or in Firefox if the web app hasn't been made yet.
--   3. Closing the netto window is "quitting the app": the server notices the window is gone
--      and stops itself ~10 s later (see backend/server/appWindow/openWindowSessions.js). Nothing else to do here.
--
-- One-time setup of the Safari web app:
--   a. Start netto once (this launcher, or npm start) and open http://localhost:3000 in Safari.
--   b. Safari > File > Add to Dock... , name it exactly "netto", click Add.
--      Safari saves it as ~/Applications/netto.app (the path launch.sh looks for).
--   c. Remove the web app's own icon from the Dock if you like (right-click > Options > Remove from Dock):
--      always open netto from THIS launcher, because the web app alone can't start the server.
--
-- Save this in Script Editor as an Application, WITHOUT "Stay open after run handler".

-- If the project folder is renamed or moved, change this path and save the application again (File > Save):
-- the saved app keeps the path it was saved with.
property launcher : "/Users/simonebidoia/Documents/netto/scripts/launch.sh"

on run
	do shell script "/bin/bash " & quoted form of launcher & " start"
end run
