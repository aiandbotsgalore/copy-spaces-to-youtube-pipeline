import ctypes
from ctypes import wintypes
u=ctypes.windll.user32
W=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
windows=[]
def callback(hwnd,lparam):
    n=u.GetWindowTextLengthW(hwnd)
    if n:
        b=ctypes.create_unicode_buffer(n+1)
        u.GetWindowTextW(hwnd,b,n+1)
        pid=wintypes.DWORD(0)
        u.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
        if pid.value==44468 or any(q in b.value.lower() for q in ['actions','script','reaper','open file']):
            windows.append((pid.value,int(hwnd),b.value))
    return True
u.EnumWindows(W(callback),0)
for a in windows:print(*a)
