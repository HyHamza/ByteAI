#pragma warning disable 649
using System;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Collections.Generic;

namespace ByteAI.Automation {
    public class ByteInputHelper {
        #region Win32 P/Invoke

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll", SetLastError = true)]
        static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint nInputs, [MarshalAs(UnmanagedType.LPArray), In] INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        const uint MOUSEEVENTF_MOVE = 0x0001;
        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x000A;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800;
        const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;

        const int SW_RESTORE = 9;
        const int SW_SHOW = 5;

        [StructLayout(LayoutKind.Explicit)]
        struct INPUT {
            [FieldOffset(0)] public int type;
            [FieldOffset(4)] public MOUSEINPUT mi;
            [FieldOffset(4)] public KEYBDINPUT ki;
        }

        struct MOUSEINPUT {
            public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
        }

        struct KEYBDINPUT {
            public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
        }

        #endregion

        public static int Main(string[] args) {
            if (args.Length == 0) {
                PrintUsage();
                return 1;
            }

            string command = args[0].ToLowerInvariant();

            try {
                switch (command) {
                    case "mouse-pos":
                        return GetMousePos();

                    case "mouse-move":
                        if (args.Length < 3) { Console.Error.WriteLine("Error: mouse-move requires <x> <y>"); return 1; }
                        return MoveMouse(int.Parse(args[1]), int.Parse(args[2]));

                    case "mouse-click":
                        string btn = args.Length > 1 ? args[1] : "left";
                        return ClickMouse(btn);

                    case "mouse-drag":
                        if (args.Length < 5) { Console.Error.WriteLine("Error: mouse-drag requires <fromX> <fromY> <toX> <toY>"); return 1; }
                        return DragMouse(int.Parse(args[1]), int.Parse(args[2]), int.Parse(args[3]), int.Parse(args[4]));

                    case "mouse-scroll":
                        if (args.Length < 2) { Console.Error.WriteLine("Error: mouse-scroll requires <delta>"); return 1; }
                        return ScrollMouse(int.Parse(args[1]));

                    case "type":
                        if (args.Length < 2) { Console.Error.WriteLine("Error: type requires <text>"); return 1; }
                        return TypeUnicode(args[1]);

                    case "key-press":
                        if (args.Length < 2) { Console.Error.WriteLine("Error: key-press requires <key>"); return 1; }
                        return PressKey(args[1]);

                    case "hotkey":
                        if (args.Length < 2) { Console.Error.WriteLine("Error: hotkey requires at least one key"); return 1; }
                        string[] keys = new string[args.Length - 1];
                        Array.Copy(args, 1, keys, 0, keys.Length);
                        return ExecuteHotkey(keys);

                    case "list-windows":
                        return ListWindows();

                    case "focus-window":
                        if (args.Length < 2) { Console.Error.WriteLine("Error: focus-window requires <titleOrPattern>"); return 1; }
                        return FocusWindow(args[1]);

                    default:
                        Console.Error.WriteLine("Unknown command: " + command);
                        PrintUsage();
                        return 1;
                }
            } catch (Exception ex) {
                Console.Error.WriteLine("Execution Error: " + ex.Message);
                return 2;
            }
        }

        static void PrintUsage() {
            Console.WriteLine("ByteInputHelper v1.0");
            Console.WriteLine("Usage: ByteInputHelper <command> [args...]");
            Console.WriteLine("Commands: mouse-pos, mouse-move <x> <y>, mouse-click [left|right|double|middle],");
            Console.WriteLine("          mouse-drag <x1> <y1> <x2> <y2>, mouse-scroll <delta>, type <text>,");
            Console.WriteLine("          key-press <key>, hotkey <key1> <key2>..., list-windows, focus-window <query>");
        }

        static int GetMousePos() {
            POINT p;
            if (GetCursorPos(out p)) {
                Console.WriteLine(string.Format("{{\"x\":{0},\"y\":{1}}}", p.X, p.Y));
            } else {
                Console.WriteLine("{\"x\":0,\"y\":0}");
            }
            return 0;
        }

        static int MoveMouse(int x, int y) {
            SetCursorPos(x, y);
            Console.WriteLine(string.Format("{{\"status\":\"ok\",\"x\":{0},\"y\":{1}}}", x, y));
            return 0;
        }

        static int ClickMouse(string button) {
            button = button.ToLowerInvariant();
            switch (button) {
                case "left":
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(30);
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    break;
                case "right":
                    mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(30);
                    mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
                    break;
                case "middle":
                    mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(30);
                    mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, UIntPtr.Zero);
                    break;
                case "double":
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(30);
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(60);
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(30);
                    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    break;
                default:
                    Console.Error.WriteLine("Unknown mouse button: " + button);
                    return 1;
            }
            Console.WriteLine(string.Format("{{\"status\":\"ok\",\"action\":\"click\",\"button\":\"{0}\"}}", button));
            return 0;
        }

        static int DragMouse(int fromX, int fromY, int toX, int toY) {
            SetCursorPos(fromX, fromY);
            Thread.Sleep(40);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(40);

            // Smooth interpolation over 10 steps
            int steps = 10;
            for (int i = 1; i <= steps; i++) {
                int currX = fromX + (toX - fromX) * i / steps;
                int currY = fromY + (toY - fromY) * i / steps;
                SetCursorPos(currX, currY);
                Thread.Sleep(15);
            }

            SetCursorPos(toX, toY);
            Thread.Sleep(40);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            Console.WriteLine(string.Format("{{\"status\":\"ok\",\"action\":\"drag\",\"fromX\":{0},\"fromY\":{1},\"toX\":{2},\"toY\":{3}}}", fromX, fromY, toX, toY));
            return 0;
        }

        static int ScrollMouse(int delta) {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
            Console.WriteLine(string.Format("{{\"status\":\"ok\",\"action\":\"scroll\",\"delta\":{0}}}", delta));
            return 0;
        }

        static int TypeUnicode(string text) {
            List<INPUT> inputs = new List<INPUT>();
            foreach (char c in text) {
                // Key down
                INPUT down = new INPUT();
                down.type = 1; // INPUT_KEYBOARD
                down.ki.wVk = 0;
                down.ki.wScan = (ushort)c;
                down.ki.dwFlags = KEYEVENTF_UNICODE;
                inputs.Add(down);

                // Key up
                INPUT up = new INPUT();
                up.type = 1;
                up.ki.wVk = 0;
                up.ki.wScan = (ushort)c;
                up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                inputs.Add(up);
            }

            INPUT[] arr = inputs.ToArray();
            SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
            Console.WriteLine(string.Format("{{\"status\":\"ok\",\"action\":\"type\",\"length\":{0}}}", text.Length));
            return 0;
        }

        static byte ResolveVirtualKey(string keyName) {
            keyName = keyName.ToLowerInvariant().Trim();
            switch (keyName) {
                case "enter": case "return": return 0x0D;
                case "esc": case "escape": return 0x1B;
                case "tab": return 0x09;
                case "backspace": return 0x08;
                case "delete": case "del": return 0x2E;
                case "space": case " ": return 0x20;
                case "up": case "arrowup": return 0x26;
                case "down": case "arrowdown": return 0x28;
                case "left": case "arrowleft": return 0x25;
                case "right": case "arrowright": return 0x27;
                case "pageup": return 0x21;
                case "pagedown": return 0x22;
                case "home": return 0x24;
                case "end": return 0x23;
                case "shift": return 0x10;
                case "ctrl": case "control": return 0x11;
                case "alt": return 0x12;
                case "win": case "windows": return 0x5B;
                case "f1": return 0x70;
                case "f2": return 0x71;
                case "f3": return 0x72;
                case "f4": return 0x73;
                case "f5": return 0x74;
                case "f6": return 0x75;
                case "f7": return 0x76;
                case "f8": return 0x77;
                case "f9": return 0x78;
                case "f10": return 0x79;
                case "f11": return 0x7A;
                case "f12": return 0x7B;
                default:
                    if (keyName.Length == 1) {
                        char c = char.ToUpperInvariant(keyName[0]);
                        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
                            return (byte)c;
                        }
                    }
                    return 0;
            }
        }

        static int PressKey(string keyName) {
            byte vk = ResolveVirtualKey(keyName);
            if (vk == 0) {
                Console.Error.WriteLine("Unknown virtual key: " + keyName);
                return 1;
            }

            keybd_event(vk, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Console.WriteLine(string.Format("{{\"status\":\"ok\",\"action\":\"key-press\",\"key\":\"{0}\"}}", keyName));
            return 0;
        }

        static int ExecuteHotkey(string[] keys) {
            List<byte> vks = new List<byte>();
            foreach (string k in keys) {
                byte vk = ResolveVirtualKey(k);
                if (vk == 0) {
                    Console.Error.WriteLine("Unknown key in hotkey: " + k);
                    return 1;
                }
                vks.Add(vk);
            }

            // Press down in order
            for (int i = 0; i < vks.Count; i++) {
                keybd_event(vks[i], 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
            }

            Thread.Sleep(40);

            // Release in reverse order
            for (int i = vks.Count - 1; i >= 0; i--) {
                keybd_event(vks[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                Thread.Sleep(20);
            }

            Console.WriteLine(string.Format("{{\"status\":\"ok\",\"action\":\"hotkey\",\"keys\":[\"{0}\"]}}", string.Join("\",\"", keys)));
            return 0;
        }

        static int ListWindows() {
            StringBuilder json = new StringBuilder();
            json.Append("[");
            bool first = true;

            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    StringBuilder sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, 256);
                    string title = sb.ToString();

                    if (!string.IsNullOrWhiteSpace(title) && title != "Program Manager") {
                        uint pid;
                        GetWindowThreadProcessId(hWnd, out pid);
                        string procName = "unknown";
                        try {
                            Process p = Process.GetProcessById((int)pid);
                            procName = p.ProcessName;
                        } catch { }

                        if (!first) json.Append(",");
                        first = false;

                        string safeTitle = title.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
                        json.Append(string.Format("{{\"handle\":\"{0}\",\"pid\":{1},\"process\":\"{2}\",\"title\":\"{3}\"}}",
                            hWnd.ToInt64(), pid, procName, safeTitle));
                    }
                }
                return true;
            }, IntPtr.Zero);

            json.Append("]");
            Console.WriteLine(json.ToString());
            return 0;
        }

        static int FocusWindow(string query) {
            query = query.ToLowerInvariant().Trim();
            IntPtr targetHwnd = IntPtr.Zero;
            string matchedTitle = "";

            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    StringBuilder sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, 256);
                    string title = sb.ToString();

                    if (!string.IsNullOrWhiteSpace(title)) {
                        uint pid;
                        GetWindowThreadProcessId(hWnd, out pid);
                        string procName = "";
                        try { procName = Process.GetProcessById((int)pid).ProcessName; } catch { }

                        if (title.ToLowerInvariant().Contains(query) || procName.ToLowerInvariant().Contains(query)) {
                            targetHwnd = hWnd;
                            matchedTitle = title;
                            return false; // Stop enumeration
                        }
                    }
                }
                return true;
            }, IntPtr.Zero);

            if (targetHwnd == IntPtr.Zero) {
                Console.WriteLine(string.Format("{{\"status\":\"not_found\",\"query\":\"{0}\"}}", query));
                return 1;
            }

            if (IsIconic(targetHwnd)) {
                ShowWindowAsync(targetHwnd, SW_RESTORE);
            } else {
                ShowWindowAsync(targetHwnd, SW_SHOW);
            }
            SetForegroundWindow(targetHwnd);

            string safeTitle = matchedTitle.Replace("\\", "\\\\").Replace("\"", "\\\"");
            Console.WriteLine(string.Format("{{\"status\":\"ok\",\"action\":\"focus\",\"handle\":\"{0}\",\"title\":\"{1}\"}}",
                targetHwnd.ToInt64(), safeTitle));
            return 0;
        }
    }
}
