const { app, BrowserWindow, screen } = require("electron");
const { execFile } = require("child_process");
const path = require("path");

let overlay = null;
let monitorTimer = null;

let lastHwnd = 0;
let seconds = 0;
let attacking = false;

const ignoredProcesses = [
    "electron",
    "lion focus",
    "lion-focus",
    "explorer",
    "shellexperiencehost",
    "startmenuexperiencehost",
    "searchhost",
    "applicationframehost"
];


// ============================================
// GET FOREGROUND WINDOWS APP
// ============================================

function getForegroundWindow(callback) {

    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public struct LF_RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}

public class LF_Win32 {

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(
        IntPtr hWnd,
        out uint processId
    );

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(
        IntPtr hWnd,
        out LF_RECT rect
    );
}
"@

$hwnd = [LF_Win32]::GetForegroundWindow()

if ($hwnd -eq [IntPtr]::Zero) {
    exit
}

$pid = 0

[LF_Win32]::GetWindowThreadProcessId(
    $hwnd,
    [ref]$pid
) | Out-Null

if ($pid -eq 0) {
    exit
}

$rect = New-Object LF_RECT

[LF_Win32]::GetWindowRect(
    $hwnd,
    [ref]$rect
) | Out-Null

$p = Get-Process -Id $pid -ErrorAction SilentlyContinue

if ($null -eq $p) {
    exit
}

[PSCustomObject]@{
    hwnd = $hwnd.ToInt64()
    pid = $pid
    process = [string]$p.ProcessName
    title = [string]$p.MainWindowTitle
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
} | ConvertTo-Json -Compress
`;

    execFile(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script
        ],
        {
            windowsHide: true,
            timeout: 3000
        },
        (error, stdout) => {

            if (error) {
                callback(null);
                return;
            }

            const output = String(stdout || "").trim();

            if (!output) {
                callback(null);
                return;
            }

            try {

                const data = JSON.parse(output);

                if (!data || !data.hwnd) {
                    callback(null);
                    return;
                }

                callback(data);

            } catch (err) {

                callback(null);

            }
        }
    );
}


// ============================================
// CLOSE EXACT WINDOW
// ============================================

function closeWindow(hwnd) {

    if (!hwnd) {
        return;
    }

    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class LF_WindowCloser {

    [DllImport("user32.dll")]
    public static extern bool PostMessage(
        IntPtr hWnd,
        uint Msg,
        IntPtr wParam,
        IntPtr lParam
    );
}
"@

[Lf_WindowCloser]::PostMessage(
    [IntPtr]${Number(hwnd)},
    0x0010,
    [IntPtr]::Zero,
    [IntPtr]::Zero
) | Out-Null
`;

    execFile(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script
        ],
        {
            windowsHide: true
        }
    );
}


// ============================================
// CREATE LION OVERLAY
// ============================================

function createOverlay() {

    const display = screen.getPrimaryDisplay();
    const bounds = display.bounds;

    overlay = new BrowserWindow({

        x: bounds.x,
        y: bounds.y,

        width: bounds.width,
        height: bounds.height,

        frame: false,

        transparent: true,

        backgroundColor: "#00000000",

        alwaysOnTop: true,

        skipTaskbar: true,

        focusable: false,

        resizable: false,

        movable: false,

        show: true,

        webPreferences: {

            nodeIntegration: true,

            contextIsolation: false
        }
    });

    overlay.setIgnoreMouseEvents(true);

    overlay.setAlwaysOnTop(
        true,
        "screen-saver"
    );

    overlay.loadFile(
        path.join(__dirname, "index.html")
    );
}


// ============================================
// RESET TIMER
// ============================================

function resetTimer() {

    lastHwnd = 0;
    seconds = 0;

    if (
        overlay &&
        !overlay.isDestroyed()
    ) {

        overlay.webContents.send(
            "reset-lion"
        );
    }
}


// ============================================
// MONITOR APPS
// ============================================

function monitorApps() {

    if (monitorTimer) {
        clearInterval(monitorTimer);
    }

    monitorTimer = setInterval(() => {

        if (attacking) {
            return;
        }

        getForegroundWindow((data) => {

            if (!data) {

                resetTimer();

                return;
            }


            const processName =
                String(data.process || "")
                .trim()
                .toLowerCase();


            // Ignore Lion Focus itself
            // and Windows desktop processes

            if (
                ignoredProcesses.includes(
                    processName
                )
            ) {

                resetTimer();

                return;
            }


            const hwnd =
                Number(data.hwnd);


            if (!hwnd) {

                resetTimer();

                return;
            }


            // =================================
            // SAME WINDOW
            // =================================

            if (hwnd === lastHwnd) {

                seconds++;

            } else {

                lastHwnd = hwnd;

                seconds = 1;
            }


            // =================================
            // SEND STATUS TO LION
            // =================================

            if (
                overlay &&
                !overlay.isDestroyed()
            ) {

                overlay.webContents.send(
                    "timer-update",
                    {
                        seconds: seconds,
                        process: data.process,
                        title: data.title
                    }
                );
            }


            // =================================
            // 30 SECOND ATTACK
            // =================================

            if (seconds >= 30) {

                attacking = true;


                if (
                    overlay &&
                    !overlay.isDestroyed()
                ) {

                    overlay.webContents.send(
                        "attack",
                        {
                            hwnd: data.hwnd,

                            left: data.left,
                            top: data.top,

                            right: data.right,
                            bottom: data.bottom
                        }
                    );
                }


                // Close target after lion animation

                setTimeout(() => {

                    closeWindow(
                        data.hwnd
                    );

                }, 3500);


                // Reset after attack

                setTimeout(() => {

                    attacking = false;

                    resetTimer();

                }, 5500);
            }

        });

    }, 1000);
}


// ============================================
// START APP
// ============================================

app.whenReady().then(() => {

    createOverlay();

    setTimeout(() => {

        monitorApps();

    }, 2000);

});


// ============================================
// KEEP APP RUNNING
// ============================================

app.on(
    "window-all-closed",
    (event) => {

        event.preventDefault();

    }
);


// ============================================
// CLEANUP
// ============================================

app.on(
    "before-quit",
    () => {

        if (monitorTimer) {

            clearInterval(
                monitorTimer
            );

            monitorTimer = null;
        }
    }
);