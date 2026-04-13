import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Calendar, 
  ClipboardCheck, 
  FileText, 
  Clock, 
  LogOut, 
  Plus, 
  Download, 
  UserPlus,
  ShieldCheck,
  ChevronRight,
  Menu,
  X,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  getDocs,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  orderBy,
  limit
} from 'firebase/firestore';
import { auth, db } from './firebase';
import * as XLSX from 'xlsx';
import { format, addMinutes, isAfter } from 'date-fns';

// --- Types ---
type Role = 'teacher' | 'admin' | null;

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: Role;
  mobile?: string;
  classLevel?: string;
  subjects?: string[];
  createdAt?: any;
}

interface AttendanceRecord {
  id: string;
  teacherId: string;
  teacherName: string;
  date: string;
  timestamp: any;
}

interface LeaveRequest {
  id: string;
  teacherId: string;
  teacherName: string;
  startDate: string;
  endDate: string;
  reason: string;
  mobile: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
}

// --- Components ---

const Navbar = ({ user, role, onLogout }: { user: FirebaseUser | null, role: Role, onLogout: () => void }) => (
  <nav className="bg-indigo-600 text-white p-4 shadow-lg flex justify-between items-center">
    <div className="flex items-center gap-2">
      <ShieldCheck className="w-8 h-8" />
      <span className="font-bold text-xl tracking-tight">SSM Portal</span>
    </div>
    {user && (
      <div className="flex items-center gap-4">
        <div className="hidden md:block text-right">
          <p className="text-sm font-medium">{user.displayName}</p>
          <p className="text-xs opacity-75 capitalize">{role}</p>
        </div>
        <button 
          onClick={onLogout}
          className="p-2 hover:bg-indigo-700 rounded-full transition-colors"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    )}
  </nav>
);

const Card = ({ title, icon: Icon, children, className = "" }: any) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-6 ${className}`}
  >
    <div className="flex items-center gap-3 mb-6">
      <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
    </div>
    {children}
  </motion.div>
);

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'home' | 'login-selection' | 'teacher-portal' | 'admin-portal' | 'teacher-login' | 'teacher-signup'>('home');
  const [attendanceCode, setAttendanceCode] = useState<string | null>(null);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  
  // Form states
  const [teacherAuth, setTeacherAuth] = useState({ id: '', pass: '' });
  const [signupForm, setSignupForm] = useState({ name: '', mobile: '', id: '', pass: '', classLevel: '6', subject: '' });
  const [leaveForm, setLeaveForm] = useState({ startDate: '', endDate: '', reason: '', mobile: '' });
  const [adminLogin, setAdminLogin] = useState({ id: '', pass: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const docRef = doc(db, 'users', u.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const profile = docSnap.data() as UserProfile;
          setUserProfile(profile);
          setView(profile.role === 'admin' ? 'admin-portal' : 'teacher-portal');
        } else {
          // If user exists in Auth but not in Firestore, they might be in middle of signup
          // or an admin who hasn't been initialized.
          setView('home');
        }
      } else {
        setView('home');
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Listeners for Admin/Teacher data
  useEffect(() => {
    if (!user || !userProfile) return;

    let unsubLeaves: any;
    let unsubAttendance: any;
    let unsubCode: any;

    if (userProfile.role === 'admin') {
      unsubLeaves = onSnapshot(collection(db, 'leaves'), (snap) => {
        setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest)));
      });
      unsubAttendance = onSnapshot(collection(db, 'attendance'), (snap) => {
        setAttendance(snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord)));
      });
    } else {
      const q = query(collection(db, 'leaves'), where('teacherId', '==', user.uid));
      unsubLeaves = onSnapshot(q, (snap) => {
        setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest)));
      });
    }

    unsubCode = onSnapshot(query(collection(db, 'attendanceCodes'), orderBy('createdAt', 'desc'), limit(1)), (snap) => {
      if (!snap.empty) {
        const data = snap.docs[0].data();
        if (isAfter(new Date(data.expiresAt), new Date())) {
          setAttendanceCode(data.code);
        } else {
          setAttendanceCode(null);
        }
      }
    });

    return () => {
      unsubLeaves?.();
      unsubAttendance?.();
      unsubCode?.();
    };
  }, [user, userProfile]);

  const handleTeacherLogin = async () => {
    try {
      setError(null);
      const email = `${teacherAuth.id}@ssm.portal`;
      await signInWithEmailAndPassword(auth, email, teacherAuth.pass);
    } catch (err: any) {
      console.error(err);
      setError("Invalid ID or Password");
    }
  };

  const handleTeacherSignup = async () => {
    try {
      setError(null);
      if (!signupForm.id || !signupForm.pass || !signupForm.name) {
        setError("Please fill all required fields");
        return;
      }
      const email = `${signupForm.id}@ssm.portal`;
      const userCredential = await createUserWithEmailAndPassword(auth, email, signupForm.pass);
      const u = userCredential.user;
      
      const profile: UserProfile = {
        uid: u.uid,
        name: signupForm.name,
        email: email,
        role: 'teacher',
        mobile: signupForm.mobile,
        classLevel: signupForm.classLevel,
        subjects: [signupForm.subject],
        createdAt: serverTimestamp() as any
      };
      await setDoc(doc(db, 'users', u.uid), profile);
      setUserProfile(profile);
      setView('teacher-portal');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Signup failed");
    }
  };

  const handleAdminLogin = async () => {
    if (adminLogin.id === 'SSM100728' && adminLogin.pass === '9923123') {
      try {
        // For admin, we use a fixed email to ensure they can always log in
        const email = "admin@ssm.portal";
        const pass = "9923123admin"; // Internal complex pass
        
        let u;
        try {
          const cred = await signInWithEmailAndPassword(auth, email, pass);
          u = cred.user;
        } catch (e) {
          const cred = await createUserWithEmailAndPassword(auth, email, pass);
          u = cred.user;
        }

        await setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          name: 'School Admin',
          email: email,
          role: 'admin',
          createdAt: serverTimestamp()
        });
        setUserProfile({ uid: u.uid, name: 'School Admin', email: email, role: 'admin' });
        setView('admin-portal');
      } catch (err) {
        console.error(err);
        setError("Admin initialization failed");
      }
    } else {
      setError("Invalid Admin Credentials");
    }
  };

  const markAttendance = async (inputCode: string) => {
    if (!user || !userProfile) return;
    if (inputCode === attendanceCode) {
      const today = format(new Date(), 'yyyy-MM-dd');
      const q = query(collection(db, 'attendance'), where('teacherId', '==', user.uid), where('date', '==', today));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        await addDoc(collection(db, 'attendance'), {
          teacherId: user.uid,
          teacherName: userProfile.name,
          date: today,
          timestamp: serverTimestamp()
        });
        alert("Attendance marked successfully!");
      } else {
        alert("Attendance already marked for today.");
      }
    } else {
      alert("Invalid or expired code.");
    }
  };

  const submitLeave = async () => {
    if (!user || !userProfile) return;
    await addDoc(collection(db, 'leaves'), {
      ...leaveForm,
      teacherId: user.uid,
      teacherName: userProfile.name,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    setLeaveForm({ startDate: '', endDate: '', reason: '', mobile: '' });
    alert("Leave application submitted.");
  };

  const generateCode = async () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await addDoc(collection(db, 'attendanceCodes'), {
      code,
      expiresAt: addMinutes(new Date(), 5).toISOString(),
      createdAt: serverTimestamp()
    });
  };

  const exportToExcel = (data: any[], fileName: string) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  if (loading) return <div className="h-screen flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      <Navbar user={user} role={userProfile?.role || null} onLogout={() => signOut(auth)} />

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center py-20"
            >
              <h1 className="text-5xl font-extrabold text-indigo-900 mb-6">Teacher Management Portal</h1>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-12">
                Welcome to S.S.M Sr. Sec. School's official management portal. 
                Streamlining attendance, leaves, and scheduling for our dedicated educators.
              </p>
              <button 
                onClick={() => setView('login-selection')}
                className="bg-indigo-600 text-white px-12 py-4 rounded-full text-lg font-bold shadow-xl hover:bg-indigo-700 transition-all transform hover:scale-105"
              >
                Get Started
              </button>
            </motion.div>
          )}

          {view === 'login-selection' && (
            <motion.div 
              key="selection"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mt-12"
            >
              <Card title="Teacher Portal" icon={Users}>
                <p className="text-gray-500 mb-6">Login with your Teacher ID and Password to access your dashboard.</p>
                <button 
                  onClick={() => setView('teacher-login')}
                  className="w-full py-3 bg-white border-2 border-indigo-600 text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
                >
                  Teacher Login
                </button>
              </Card>
              <Card title="Admin Portal" icon={ShieldCheck}>
                <div className="space-y-4">
                  <input 
                    type="text" placeholder="Admin ID" 
                    className="w-full p-3 border rounded-xl"
                    value={adminLogin.id} onChange={e => setAdminLogin({...adminLogin, id: e.target.value})}
                  />
                  <input 
                    type="password" placeholder="Password" 
                    className="w-full p-3 border rounded-xl"
                    value={adminLogin.pass} onChange={e => setAdminLogin({...adminLogin, pass: e.target.value})}
                  />
                  <button 
                    onClick={handleAdminLogin}
                    className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors"
                  >
                    Admin Access
                  </button>
                  {error && <p className="text-red-500 text-sm flex items-center gap-1"><AlertCircle className="w-4 h-4" /> {error}</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {view === 'teacher-login' && (
            <motion.div key="teacher-login" className="max-w-md mx-auto mt-12">
              <Card title="Teacher Login" icon={Users}>
                <div className="space-y-4">
                  <input 
                    type="text" placeholder="Teacher ID" className="w-full p-3 border rounded-xl"
                    value={teacherAuth.id} onChange={e => setTeacherAuth({...teacherAuth, id: e.target.value})}
                  />
                  <input 
                    type="password" placeholder="Password" className="w-full p-3 border rounded-xl"
                    value={teacherAuth.pass} onChange={e => setTeacherAuth({...teacherAuth, pass: e.target.value})}
                  />
                  <button 
                    onClick={handleTeacherLogin}
                    className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700"
                  >
                    Login
                  </button>
                  <div className="text-center">
                    <button 
                      onClick={() => setView('teacher-signup')}
                      className="text-indigo-600 text-sm font-medium hover:underline"
                    >
                      New User? Sign In
                    </button>
                  </div>
                  {error && <p className="text-red-500 text-sm flex items-center gap-1"><AlertCircle className="w-4 h-4" /> {error}</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {view === 'teacher-signup' && (
            <motion.div key="teacher-signup" className="max-w-md mx-auto mt-12">
              <Card title="Teacher Registration" icon={UserPlus}>
                <div className="space-y-4">
                  <input 
                    type="text" placeholder="Full Name" className="w-full p-3 border rounded-xl"
                    value={signupForm.name} onChange={e => setSignupForm({...signupForm, name: e.target.value})}
                  />
                  <input 
                    type="text" placeholder="Mobile Number" className="w-full p-3 border rounded-xl"
                    value={signupForm.mobile} onChange={e => setSignupForm({...signupForm, mobile: e.target.value})}
                  />
                  <input 
                    type="text" placeholder="Desired Teacher ID" className="w-full p-3 border rounded-xl"
                    value={signupForm.id} onChange={e => setSignupForm({...signupForm, id: e.target.value})}
                  />
                  <input 
                    type="password" placeholder="Password" className="w-full p-3 border rounded-xl"
                    value={signupForm.pass} onChange={e => setSignupForm({...signupForm, pass: e.target.value})}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <select 
                      className="w-full p-3 border rounded-xl"
                      value={signupForm.classLevel} onChange={e => setSignupForm({...signupForm, classLevel: e.target.value})}
                    >
                      <option value="">Select Class</option>
                      {[6,7,8,9,10,11,12].map(n => <option key={n} value={n}>Class {n}</option>)}
                    </select>
                    <input 
                      type="text" placeholder="Subject" className="w-full p-3 border rounded-xl"
                      value={signupForm.subject} onChange={e => setSignupForm({...signupForm, subject: e.target.value})}
                    />
                  </div>
                  <button 
                    onClick={handleTeacherSignup}
                    className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700"
                  >
                    Create Account
                  </button>
                  <div className="text-center">
                    <button 
                      onClick={() => setView('teacher-login')}
                      className="text-indigo-600 text-sm font-medium hover:underline"
                    >
                      Already have an account? Login
                    </button>
                  </div>
                  {error && <p className="text-red-500 text-sm flex items-center gap-1"><AlertCircle className="w-4 h-4" /> {error}</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {view === 'teacher-portal' && (
            <motion.div key="teacher" className="grid md:grid-cols-3 gap-8">
              <Card title="Attendance" icon={ClipboardCheck}>
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">Enter the 6-digit code provided by the administrator.</p>
                  <input 
                    type="text" maxLength={6} placeholder="000000"
                    className="w-full p-4 text-center text-3xl font-mono tracking-widest border-2 border-indigo-100 rounded-2xl focus:border-indigo-600 outline-none"
                    onChange={(e) => { if(e.target.value.length === 6) markAttendance(e.target.value); }}
                  />
                  <button 
                    onClick={() => exportToExcel(attendance.filter(a => a.teacherId === user?.uid), 'My_Attendance')}
                    className="w-full flex items-center justify-center gap-2 text-indigo-600 font-medium py-2 hover:bg-indigo-50 rounded-lg"
                  >
                    <Download className="w-4 h-4" /> Download History
                  </button>
                </div>
              </Card>

              <Card title="Leave Application" icon={FileText}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" className="p-2 border rounded-lg text-sm" value={leaveForm.startDate} onChange={e => setLeaveForm({...leaveForm, startDate: e.target.value})} />
                    <input type="date" className="p-2 border rounded-lg text-sm" value={leaveForm.endDate} onChange={e => setLeaveForm({...leaveForm, endDate: e.target.value})} />
                  </div>
                  <textarea 
                    placeholder="Reason for leave" className="w-full p-2 border rounded-lg text-sm h-20"
                    value={leaveForm.reason} onChange={e => setLeaveForm({...leaveForm, reason: e.target.value})}
                  />
                  <input type="text" placeholder="Mobile" className="w-full p-2 border rounded-lg text-sm" value={leaveForm.mobile} onChange={e => setLeaveForm({...leaveForm, mobile: e.target.value})} />
                  <button onClick={submitLeave} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-bold">Submit</button>
                </div>
              </Card>

              <Card title="Time Table" icon={Clock}>
                <div className="space-y-4">
                  <div className="p-4 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-center">
                    <p className="text-gray-500 text-sm">Your weekly schedule will appear here.</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {view === 'admin-portal' && (
            <motion.div key="admin" className="space-y-8">
              <div className="grid md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-100">
                  <p className="text-gray-500 text-sm mb-1">Active Code</p>
                  <h2 className="text-3xl font-mono font-bold text-indigo-600">{attendanceCode || '------'}</h2>
                  <button onClick={generateCode} className="mt-4 text-sm font-bold text-indigo-600 hover:underline flex items-center gap-1">
                    <Plus className="w-4 h-4" /> Generate New
                  </button>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <p className="text-gray-500 text-sm mb-1">Pending Leaves</p>
                  <h2 className="text-3xl font-bold text-gray-800">{leaves.filter(l => l.status === 'pending').length}</h2>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <p className="text-gray-500 text-sm mb-1">Today's Attendance</p>
                  <h2 className="text-3xl font-bold text-gray-800">{attendance.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).length}</h2>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <button 
                    onClick={() => exportToExcel(attendance, 'School_Attendance_Report')}
                    className="w-full h-full flex flex-col items-center justify-center gap-2 text-indigo-600 font-bold"
                  >
                    <Download className="w-8 h-8" />
                    Export Report
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <Card title="Leave Requests" icon={FileText}>
                  <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                    {leaves.map(leave => (
                      <div key={leave.id} className="p-4 bg-gray-50 rounded-xl flex justify-between items-center">
                        <div>
                          <p className="font-bold">{leave.teacherName}</p>
                          <p className="text-xs text-gray-500">{leave.startDate} to {leave.endDate}</p>
                          <p className="text-sm mt-1 italic">"{leave.reason}"</p>
                        </div>
                        <div className="flex gap-2">
                          <button className="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200"><ClipboardCheck className="w-4 h-4" /></button>
                          <button className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"><X className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Time Table Management" icon={Calendar}>
                  <div className="space-y-4">
                    <button className="w-full py-4 bg-indigo-50 text-indigo-600 rounded-2xl border-2 border-indigo-100 border-dashed font-bold hover:bg-indigo-100 transition-all">
                      AI Generate Time Table
                    </button>
                    <div className="grid grid-cols-2 gap-4">
                      <button className="p-4 bg-white border rounded-xl text-sm font-medium hover:bg-gray-50">Manage Subjects</button>
                      <button className="p-4 bg-white border rounded-xl text-sm font-medium hover:bg-gray-50">Teacher List</button>
                    </div>
                  </div>
                </Card>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
