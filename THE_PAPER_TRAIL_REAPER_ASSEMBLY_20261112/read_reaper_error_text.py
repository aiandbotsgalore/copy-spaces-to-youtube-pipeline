import ctypes
from ctypes import wintypes
u=ctypes.windll.user32
u.SendMessageW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM]
u.SendMessageW.restype=wintypes.LPARAM
for h in [5707102,919890]:
 n=u.SendMessageW(h,14,0,0)
 b=ctypes.create_unicode_buffer(min(50000,n+100))
 u.SendMessageW(h,13,len(b),ctypes.cast(b,ctypes.c_void_p).value)
 print('HANDLE',h,'LENGTH',n,'TEXT',repr(b.value[:9000]))
