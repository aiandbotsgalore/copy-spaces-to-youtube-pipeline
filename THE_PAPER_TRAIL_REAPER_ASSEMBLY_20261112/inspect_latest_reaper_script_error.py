import ctypes
from ctypes import wintypes
u=ctypes.windll.user32
W=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
def txt(h):
 n=u.GetWindowTextLengthW(h);b=ctypes.create_unicode_buffer(n+1)
 u.GetWindowTextW(h,b,len(b));return b.value
def cls(h):
 b=ctypes.create_unicode_buffer(128);u.GetClassNameW(h,b,len(b));return b.value
for hwnd in [1770242,3212604]:
 print('DIALOG',hwnd,cls(hwnd),repr(txt(hwnd)))
 def cb(h,l):
  print('CHILD',int(h),cls(h),repr(txt(h))[:2500]);return True
 u.EnumChildWindows(hwnd,W(cb),0)
