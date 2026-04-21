# Security Specification for SSM Teacher Portal

## 1. Data Invariants
- A Teacher can only view their own Attendance and Leaves.
- An Admin can view ALL Attendance, Leaves, and Users.
- Only Admins can modify Settings, Timetables, and Arrangements.
- Teachers can only create Leaves for themselves.
- Attendance records must belong to the logged-in teacher during creation.
- A user's role cannot be self-escalated.

## 2. The "Dirty Dozen" Payloads (Testing for Denial)

### P1: Identity Spoofing (Attendance)
Try to mark attendance for a different teacher.
```json
{
  "teacherId": "DIFFERENT_TEACHER_UID",
  "teacherName": "Someone Else",
  "date": "2026-04-20",
  "timestamp": "2026-04-20T10:00:00Z"
}
```
**Expected:** PERMISSION_DENIED

### P2: State Shortcutting (Leaves)
Create a leave already "approved".
```json
{
  "teacherId": "CURRENT_USER_UID",
  "status": "approved",
  "startDate": "2026-04-21",
  "endDate": "2026-04-22"
}
```
**Expected:** PERMISSION_DENIED

### P3: Resource Poisoning (ID Infection)
Attempt to create a document with a massive ID.
**Expected:** PERMISSION_DENIED (via isValidId check)

### P4: Role Escalation (Profile)
Try to update own role to 'admin'.
```json
{
  "role": "admin"
}
```
**Expected:** PERMISSION_DENIED

### P5: Unauthorized List (Users)
A teacher trying to list the entire `/users` collection.
**Expected:** PERMISSION_DENIED

### P6: Unauthorized Read (Private Settings)
Unauthenticated user trying to read `/settings/timetable`.
**Expected:** PERMISSION_DENIED

### P7: Admin Impersonation (Email)
A user with email `fake-admin@ssm.portal` trying to write to `/settings/school`.
**Expected:** PERMISSION_DENIED

### P8: Orphaned Record (Attendance)
Create attendance for a teacher ID that doesn't exist in `/users`.
**Expected:** PERMISSION_DENIED (via exists check)

### P9: Shadow Field Write
Update profile with an unlisted field `isVerified: true`.
**Expected:** PERMISSION_DENIED (via affectedKeys check)

### P10: Terminal State Lock
Attempt to change a "rejected" leave back to "pending".
**Expected:** PERMISSION_DENIED

### P11: Temporal Integrity Break
Attempt to set `createdAt` to a past date.
**Expected:** PERMISSION_DENIED (must match server time)

### P12: Large String Injection
Set `reason` in leave to 2MB string.
**Expected:** PERMISSION_DENIED (via .size() check)

## 3. Deployment Plan
I will now generate the hardened `firestore.rules`.
