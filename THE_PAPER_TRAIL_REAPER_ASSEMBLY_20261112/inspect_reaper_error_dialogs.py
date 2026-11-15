import ctypes
from ctypes import wintypes
u=ctypes.windll.user32
C=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
def txt(h):
 z=u.GetWindowTextLengthW(h)
 b=ctypes.create_unicode_buffer(z+1)
 u.GetWindowTextW(h,b,len(b))
 return b.value
def clas(h):
 b=ctypes.create_unicode_buffer(256)
 u.GetClassNameW(h,b,256)
 return b.value
def child(hwnd):
 v=[]
 def cb(h,l):
  t=txt(h)
  if t:v.append((int(h),clas(h),t))
  return True
 u.EnumChildWindows(hwnd,C(cb),0)
 return v
def parentcb(hwnd,l):
 v=txt(hwnd)
 if v in ['THE PAPER TRAIL','REAPER']:
  pid=wintypes.DWORD()
  u.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
  print('MODAL',pid.value,int(hwnd),v,'CHILDREN',child(hwnd))
 return True
u.EnumWindows(C(parentcb),0)
