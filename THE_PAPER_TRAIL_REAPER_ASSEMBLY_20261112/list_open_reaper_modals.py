import ctypes
from ctypes import wintypes
u=ctypes.windll.user32
def getwin(hwnd):
 n=u.GetWindowTextLengthW(hwnd)
 s=ctypes.create_unicode_buffer(n+1)
 u.GetWindowTextW(hwnd,s,len(s))
 return s.value
W=wintypes.HWND
C=ctypes.WINFUNCTYPE(wintypes.BOOL,W,wintypes.LPARAM)
matches=[]
def cb(hwnd,lparam):
 v=getwin(hwnd)
 if 'PAPER TRAIL' in v.upper() or 'REAPER' in v.upper() or 'LABEL' in v.upper() or 'ERROR' in v.upper():
  p=wintypes.DWORD()
  u.GetWindowThreadProcessId(hwnd,ctypes.byref(p))
  matches.append((p.value,int(hwnd),v))
 return True
u.EnumWindows(C(cb),0)
for x in matches:print(x)
