STELCO Legal Department Management System (LDMS) - LOCAL EDITION
===================================================================

Runs the complete application on ONE computer with only Node.js installed.
No Docker, no PostgreSQL, no Redis, no ClamAV, no pnpm.
It is for trying and testing the app. It is NOT the production setup
(production runs on servers; see source\stelco-ldms\docs\IT_SETUP.md).


WHAT YOU NEED
-------------
  * Node.js 22 or newer. Check with:   node -v
    Download from https://nodejs.org (choose "LTS").
  * An internet connection for the first "npm install" (it downloads the libraries).
  * About 1 GB of free disk space.


START IT (Windows: Command Prompt or PowerShell; Mac/Linux: Terminal)
--------
  1. Unzip this folder, for example to C:\ldms-local

  2. Open Command Prompt in that folder:
        cd C:\ldms-local\stelco-ldms-local

  3. Install the libraries (once, takes a few minutes):
        npm install

  4. Start LDMS:
        npm start

     Wait for the box that says "LDMS (local edition) is running".
     Leave this window open. Ctrl+C stops LDMS.

  5. Open  http://localhost:3000  in your browser.
     (Use "localhost", not "127.0.0.1".)


SIGN IN
-------
  Username : hod          (Head of Legal Department - sees everything)
  Password : open the file  data\local.env  in Notepad and copy the text
             after  DEMO_PASSWORD=   (all demo users share this password)
  6-digit code : open a SECOND Command Prompt in the same folder and run
                    npm run code
                 Type the code it shows. Each code works only once; if it is
                 refused, wait 30 seconds and run  npm run code  again.

  Tip: use a private/incognito browser window for each extra user, so you can
  be signed in as several people at the same time.


DEMO USERS
----------
  hod                         Head of Legal Department
  uh.lit uh.drf uh.cmp uh.awr  Unit Heads: Litigation, Drafting, Compliance, Awareness
  lo.lit1 lo.lit2              Legal Officers, Litigation
  lo.drf1 lo.drf2              Legal Officers, Drafting
  lo.cmp1                      Legal Officer, Compliance
  lo.awr1                      Legal Officer, Awareness
  pl.lit pl.drf                Paralegals
  req.fin req.hr req.proc      Staff of Finance, HR, Procurement (department portal)
  auditor                      Internal Auditor (audit log)
  mgmt                         Management (summary dashboard only)
  adm.it                       IT administrator (users/settings, no legal content)


WHAT TO TRY
-----------
  A step-by-step test checklist is in   source\stelco-ldms\docs\TESTING.md
  (section 2, "Manual acceptance testing"). Everything in it works here, except:
    * Emails are not sent (no mail server). Notifications still appear in the app.
    * Virus scanning: only the standard EICAR antivirus TEST file is recognised and
      blocked (to show the feature). Real virus scanning needs ClamAV (production).
    * Text recognition (OCR) of scanned PDFs is off.
  Latest: Unit Head/HoD can assign or reassign at any stage in every unit,
  "Send for approval without review" and "Complete task" in Drafting, and
  "Assign research" buttons in Compliance (Research tab and each law).
  Also new: hearing reminders (afternoon before + morning list);
  appeal and comply-by deadlines on judgments; workload per lawyer (dashboard);
  template & clause library with approval and earlier versions ("Start from a
  template" on a drafting request); report formats sent automatically every
  Sunday / 1st of the month; Dhivehi screens (language button in the top bar,
  wording editable under "Dhivehi wording"); Dhivehi prints correctly in PDFs.
  Earlier: hearing chit/postpone/continuance, change history, drafting versions,
  compliance yes/no, your own report formats, Dhivehi keyboard (Ctrl+Shift+D).
  Everything else - all four units, workflows, deadlines (Sun-Thu business days),
  dashboards, search, reports, Excel import/export, access rules, row-level
  security in the database and the audit log - is the real application code.


START AGAIN / START FRESH
-------------------------
  Next time:   npm start           (your data is kept in the "data" folder)
  Start fresh: stop LDMS (Ctrl+C), delete the "data" folder, then  npm start
               (a NEW demo password is created - look in data\local.env again)


IF SOMETHING GOES WRONG
-----------------------
  "Port 3000 is already in use"  -> LDMS (or another program) is already running.
                                   Close it, or start on another port:
                                     set LDMS_PORT=3100        (Command Prompt)
                                     $env:LDMS_PORT=3100       (PowerShell)
                                   then  npm start  and open http://localhost:3100
  "Dependencies are missing"     -> run  npm install  first.
  Anything else                  -> copy the text from the window and send it.


THE SOURCE CODE
---------------
  The "source" folder contains the complete, readable source code (TypeScript)
  with its documentation:
    source\stelco-ldms\README.md        overview and developer setup
    source\stelco-ldms\docs\            plan, security, IT setup, user guides, testing
    source\stelco-ldms\apps\api\src\    back end (NestJS)
    source\stelco-ldms\apps\web\        front end (Next.js)
  The "app" folder is the same code, compiled and ready to run.
