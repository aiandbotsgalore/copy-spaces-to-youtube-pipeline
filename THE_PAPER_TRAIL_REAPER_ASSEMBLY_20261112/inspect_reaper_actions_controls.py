import ctypes
from ctypes import wintypes
u=ctypes.windll.user32
CB=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
def t(h):
    n=u.GetWindowTextLengthW(h);b=ctypes.create_unicode_buffer(n+1)
    u.GetWindowTextW(h,b,n+1)
    return b.value
def cl(h):
    b=ctypes.create_unicode_buffer(150)
    u.GetClassNameW(h,b,len(b))
    return b.value
found=[]
def parent(h,l):
    if t(h)=='Actions':
        found.append(h)
    return True
u.EnumWindows(CB(parent),0)
for h in found:
    print('WINDOW',int(h),t(h),'CLASS',cl(h))
    def child(c,l):
        pid=wintypes.DWORD(0);u.GetWindowThreadProcessId(c,ctypes.byref(pid))
        depth=0
        parent=u.GetParent(c)
        while parent and parent!=h:
            depth+=1
            parent=u.GetParent(parent)
        if pid.value==44468:
            print('CHILD',int(c),'DEPTH',depth,'CLASS',cl(c),'TEXT',repr(t(c)))
        return True
    u.EnumChildWindows(h,CB(child),0)
