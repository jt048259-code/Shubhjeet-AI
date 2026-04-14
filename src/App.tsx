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
  AlertCircle,
  ChevronLeft,
  Search,
  Settings,
  UserCheck,
  UserX,
  Sparkles,
  LayoutDashboard
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
import { 
  format, 
  addMinutes, 
  isAfter, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addMonths, 
  subMonths,
  isSameDay,
  isPast,
  isToday,
  getDay
} from 'date-fns';

// --- Types ---
type Role = 'teacher' | 'admin' | null;

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: Role;
  mobile?: string;
  classes?: string[];
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

const AttendanceGrid = ({ month, teachers, attendance, leaves }: { month: Date, teachers: UserProfile[], attendance: AttendanceRecord[], leaves: LeaveRequest[] }) => {
  const days = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month)
  });

  const getStatus = (teacherId: string, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const isPresent = attendance.some(a => a.teacherId === teacherId && a.date === dateStr);
    if (isPresent) return { char: 'P', color: 'text-green-600 bg-green-50' };
    
    const onLeave = leaves.some(l => l.teacherId === teacherId && l.status === 'approved' && dateStr >= l.startDate && dateStr <= l.endDate);
    if (onLeave) return { char: 'L', color: 'text-orange-600 bg-orange-50' };
    
    if (isPast(date) && !isToday(date) && getDay(date) !== 0) { // Exclude Sundays
      return { char: 'A', color: 'text-red-600 bg-red-50' };
    }
    
    return { char: '', color: '' };
  };

  return (
    <div className="overflow-x-auto border rounded-xl shadow-sm bg-white">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b">
            <th className="p-3 text-left border-r sticky left-0 bg-gray-50 z-10 w-40">Teacher Name</th>
            {days.map(day => (
              <th key={day.toString()} className={`p-2 border-r min-w-[30px] text-center ${getDay(day) === 0 ? 'bg-red-50 text-red-500' : ''}`}>
                {format(day, 'd')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teachers.map(teacher => (
            <tr key={teacher.uid} className="border-b hover:bg-gray-50 transition-colors">
              <td className="p-3 border-r sticky left-0 bg-white z-10 font-medium shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                {teacher.name}
              </td>
              {days.map(day => {
                const status = getStatus(teacher.uid, day);
                return (
                  <td key={day.toString()} className={`p-2 border-r text-center font-bold ${status.color} ${getDay(day) === 0 ? 'bg-red-50/30' : ''}`}>
                    {status.char}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Navbar = ({ user, role, userProfile, onLogout }: { user: FirebaseUser | null, role: Role, userProfile: UserProfile | null, onLogout: () => void }) => (
  <nav className="bg-indigo-600 text-white p-4 shadow-lg flex justify-between items-center">
    <div className="flex items-center gap-2">
      <ShieldCheck className="w-8 h-8" />
      <span className="font-bold text-xl tracking-tight">SSM Portal</span>
    </div>
    {user && (
      <div className="flex items-center gap-4">
        <div className="hidden md:block text-right">
          <p className="text-sm font-medium">{role === 'admin' ? 'School Admin' : (userProfile?.name || 'Teacher')}</p>
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
  const [view, setView] = useState<'home' | 'login-selection' | 'teacher-portal' | 'admin-portal' | 'teacher-login' | 'teacher-signup' | 'admin-login'>('home');
  const [attendanceCode, setAttendanceCode] = useState<string | null>(null);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [schoolSettings, setSchoolSettings] = useState<{ subjects: string[], classes: string[] }>({ subjects: [], classes: [] });
  const [activeTeacherSection, setActiveTeacherSection] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [allTeachers, setAllTeachers] = useState<UserProfile[]>([]);
  const [allAttendance, setAllAttendance] = useState<AttendanceRecord[]>([]);
  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  
  // Form states
  const [teacherAuth, setTeacherAuth] = useState({ id: '', pass: '' });
  const [signupForm, setSignupForm] = useState({ 
    name: '', 
    mobile: '', 
    id: '', 
    pass: '', 
    classes: [] as string[], 
    subjects: [] as string[] 
  });
  const [newSubject, setNewSubject] = useState('');
  const [leaveForm, setLeaveForm] = useState({ startDate: '', endDate: '', reason: '', mobile: '' });
  const [adminLogin, setAdminLogin] = useState({ id: '', pass: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      console.log("Auth state changed:", u?.uid);
      setUser(u);
      if (u) {
        try {
          const docRef = doc(db, 'users', u.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const profile = docSnap.data() as UserProfile;
            setUserProfile(profile);
            setView(profile.role === 'admin' ? 'admin-portal' : 'teacher-portal');
          } else {
            console.log("No profile found for user:", u.uid);
            // Check if this is the special admin email
            if (u.email === 'admin@ssm.portal') {
              const profile: UserProfile = {
                uid: u.uid,
                name: 'School Admin',
                email: u.email,
                role: 'admin',
                createdAt: serverTimestamp()
              };
              await setDoc(docRef, profile);
              setUserProfile(profile);
              setView('admin-portal');
            } else {
              setView('home');
            }
          }
        } catch (err) {
          console.error("Profile fetch error:", err);
          setError("Failed to load user profile.");
        }
      } else {
        setUserProfile(null);
        setView('home');
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    setError(null);
  }, [view]);

  // Listeners for Global Settings (Public)
  useEffect(() => {
    const unsubSettings = onSnapshot(doc(db, 'settings', 'school'), (snap) => {
      if (snap.exists()) {
        setSchoolSettings(snap.data() as any);
      } else {
        const defaults = { 
          subjects: ['Mathematics', 'Science', 'English', 'Hindi', 'Social Science'], 
          classes: ['6', '7', '8', '9', '10', '11', '12'] 
        };
        setSchoolSettings(defaults);
      }
    }, (err) => console.error("Settings error:", err));

    return () => unsubSettings();
  }, []);

  // Listeners for Admin/Teacher data
  useEffect(() => {
    if (!user || !userProfile) return;

    let unsubLeaves: any;
    let unsubAttendance: any;
    let unsubCode: any;
    let unsubTeachers: any;

    if (userProfile.role === 'admin') {
      unsubLeaves = onSnapshot(collection(db, 'leaves'), (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
        setLeaves(data);
        setAllLeaves(data);
      }, (err) => console.error("Leaves error:", err));
      
      unsubAttendance = onSnapshot(collection(db, 'attendance'), (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
        setAttendance(data);
        setAllAttendance(data);
      }, (err) => console.error("Attendance error:", err));

      unsubTeachers = onSnapshot(query(collection(db, 'users'), where('role', '==', 'teacher')), (snap) => {
        setAllTeachers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
      });
    } else {
      const q = query(collection(db, 'leaves'), where('teacherId', '==', user.uid));
      unsubLeaves = onSnapshot(q, (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
        setLeaves(data);
        setAllLeaves(data);
      }, (err) => console.error("Teacher leaves error:", err));

      const qAtt = query(collection(db, 'attendance'), where('teacherId', '==', user.uid));
      unsubAttendance = onSnapshot(qAtt, (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
        setAttendance(data);
        setAllAttendance(data);
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
    }, (err) => console.error("Code error:", err));

    return () => {
      unsubLeaves?.();
      unsubAttendance?.();
      unsubCode?.();
      unsubTeachers?.();
    };
  }, [user, userProfile]);

  const handleTeacherLogin = async () => {
    try {
      setError(null);
      if (!teacherAuth.id || !teacherAuth.pass) {
        setError("Please enter ID and Password");
        return;
      }
      const email = `${teacherAuth.id}@ssm.portal`;
      await signInWithEmailAndPassword(auth, email, teacherAuth.pass);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError("Invalid Teacher ID or Password");
      } else {
        setError("Login failed: " + err.message);
      }
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
        classes: signupForm.classes,
        subjects: signupForm.subjects,
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
    setError(null);
    if (adminLogin.id === 'SSM100728' && adminLogin.pass === '9923123') {
      try {
        const email = "admin@ssm.portal";
        const pass = "9923123admin";
        
        let u;
        try {
          const cred = await signInWithEmailAndPassword(auth, email, pass);
          u = cred.user;
        } catch (e) {
          const cred = await createUserWithEmailAndPassword(auth, email, pass);
          u = cred.user;
        }

        const profile: UserProfile = {
          uid: u.uid,
          name: 'School Admin',
          email: email,
          role: 'admin',
          createdAt: serverTimestamp()
        };
        await setDoc(doc(db, 'users', u.uid), profile);
        setUserProfile(profile);
        setView('admin-portal');
        
        // Ensure default settings exist
        const settingsSnap = await getDoc(doc(db, 'settings', 'school'));
        if (!settingsSnap.exists()) {
          await setDoc(doc(db, 'settings', 'school'), { 
            subjects: ['Mathematics', 'Science', 'English', 'Hindi', 'Social Science'], 
            classes: ['6', '7', '8', '9', '10', '11', '12'] 
          });
        }
      } catch (err: any) {
        console.error(err);
        setError("Admin initialization failed: " + err.message);
      }
    } else {
      setError("Invalid Admin Credentials");
    }
  };

  const exportMasterAttendance = () => {
    const days = eachDayOfInterval({
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth)
    });

    const data = allTeachers.map(teacher => {
      const row: any = { 'Teacher Name': teacher.name };
      days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const isPresent = allAttendance.some(a => a.teacherId === teacher.uid && a.date === dateStr);
        const onLeave = allLeaves.some(l => l.teacherId === teacher.uid && l.status === 'approved' && dateStr >= l.startDate && dateStr <= l.endDate);
        
        let status = '';
        if (isPresent) status = 'P';
        else if (onLeave) status = 'L';
        else if (isPast(day) && !isToday(day) && getDay(day) !== 0) status = 'A';
        
        row[format(day, 'd')] = status;
      });
      return row;
    });

    exportToExcel(data, `Master_Attendance_${format(currentMonth, 'MMM_yyyy')}`);
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

  const updateLeaveStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await setDoc(doc(db, 'leaves', id), { status }, { merge: true });
    } catch (err) {
      console.error("Update leave error:", err);
      alert("Failed to update leave status.");
    }
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
      <Navbar user={user} role={userProfile?.role || null} userProfile={userProfile} onLogout={() => signOut(auth)} />

      <header className="bg-white border-b py-6 px-4 md:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <h1 className="text-2xl md:text-3xl font-extrabold text-indigo-900 tracking-tight">
            S.S.M. Sr. Sec. School - Teacher Management Portal
          </h1>
          {view === 'home' && !user && (
            <button 
              onClick={() => setView('login-selection')}
              className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all"
            >
              Login
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center py-20"
            >
              <div className="mb-12">
                <div className="w-24 h-24 bg-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <ShieldCheck className="w-12 h-12 text-indigo-600" />
                </div>
                <h2 className="text-5xl font-black text-indigo-950 mb-6 leading-tight">
                  Empowering Educators,<br />Streamlining Excellence.
                </h2>
                <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-12">
                  Welcome to the official management portal of S.S.M. Sr. Sec. School. 
                  A unified platform for attendance, leaves, and smart scheduling.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button 
                    onClick={() => setView('login-selection')}
                    className="bg-indigo-600 text-white px-12 py-4 rounded-2xl text-lg font-bold shadow-2xl hover:bg-indigo-700 transition-all transform hover:scale-105 flex items-center justify-center gap-2"
                  >
                    Get Started <ChevronRight className="w-5 h-5" />
                  </button>
                  <button className="bg-white text-indigo-600 border-2 border-indigo-100 px-12 py-4 rounded-2xl text-lg font-bold hover:bg-indigo-50 transition-all">
                    Learn More
                  </button>
                </div>
              </div>
              
              <div className="grid md:grid-cols-3 gap-8 mt-20">
                {[
                  { title: "Smart Attendance", desc: "Secure 6-digit code based verification", icon: UserCheck },
                  { title: "AI Scheduling", desc: "Automated time table & arrangement", icon: Sparkles },
                  { title: "Easy Leaves", desc: "Quick application & approval workflow", icon: FileText }
                ].map((feature, i) => (
                  <div key={i} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                    <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-4">
                      <feature.icon className="w-6 h-6 text-indigo-600" />
                    </div>
                    <h4 className="text-lg font-bold mb-2">{feature.title}</h4>
                    <p className="text-gray-500 text-sm">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'login-selection' && (
            <motion.div 
              key="selection"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mt-12"
            >
              <div 
                onClick={() => setView('teacher-login')}
                className="bg-white p-12 rounded-3xl shadow-xl border-2 border-transparent hover:border-indigo-600 cursor-pointer transition-all group text-center"
              >
                <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-indigo-600 transition-colors">
                  <Users className="w-10 h-10 text-indigo-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-2xl font-black text-indigo-950 mb-2">Teacher Login</h3>
                <p className="text-gray-500">Access your attendance, leaves, and schedule.</p>
              </div>

              <div 
                onClick={() => setView('admin-login')}
                className="bg-white p-12 rounded-3xl shadow-xl border-2 border-transparent hover:border-indigo-600 cursor-pointer transition-all group text-center"
              >
                <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-indigo-600 transition-colors">
                  <ShieldCheck className="w-10 h-10 text-indigo-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-2xl font-black text-indigo-950 mb-2">Admin Login</h3>
                <p className="text-gray-500">Manage school operations and reports.</p>
              </div>
            </motion.div>
          )}

          {view === 'admin-login' && (
            <motion.div key="admin-login" className="max-w-md mx-auto mt-12">
              <Card title="Admin Login" icon={ShieldCheck}>
                <div className="space-y-4">
                  <input 
                    type="text" placeholder="Admin ID" 
                    className="w-full p-3 border rounded-xl focus:border-indigo-600 outline-none"
                    value={adminLogin.id} onChange={e => setAdminLogin({...adminLogin, id: e.target.value})}
                  />
                  <input 
                    type="password" placeholder="Password" 
                    className="w-full p-3 border rounded-xl focus:border-indigo-600 outline-none"
                    value={adminLogin.pass} onChange={e => setAdminLogin({...adminLogin, pass: e.target.value})}
                  />
                  <button 
                    onClick={handleAdminLogin}
                    className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg"
                  >
                    Login as Admin
                  </button>
                  <button 
                    onClick={() => setView('login-selection')}
                    className="w-full text-indigo-600 text-sm font-medium hover:underline"
                  >
                    Back to Selection
                  </button>
                  {error && <p className="text-red-500 text-sm flex items-center gap-1 justify-center mt-2"><AlertCircle className="w-4 h-4" /> {error}</p>}
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
            <motion.div key="teacher-signup" className="max-w-2xl mx-auto mt-12">
              <Card title="Teacher Registration" icon={UserPlus}>
                <div className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-4">
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
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Select Classes</label>
                    <div className="grid grid-cols-4 gap-2">
                      {schoolSettings.classes.map(cls => (
                        <label key={cls} className={`flex items-center justify-center p-2 border rounded-lg cursor-pointer transition-all ${signupForm.classes.includes(cls) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                          <input 
                            type="checkbox" className="hidden" 
                            checked={signupForm.classes.includes(cls)}
                            onChange={(e) => {
                              const classes = e.target.checked 
                                ? [...signupForm.classes, cls]
                                : signupForm.classes.filter(c => c !== cls);
                              setSignupForm({...signupForm, classes});
                            }}
                          />
                          Class {cls}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Select Subjects</label>
                    <div className="flex flex-wrap gap-2">
                      {schoolSettings.subjects.map(sub => (
                        <label key={sub} className={`flex items-center justify-center px-4 py-2 border rounded-full cursor-pointer transition-all ${signupForm.subjects.includes(sub) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                          <input 
                            type="checkbox" className="hidden" 
                            checked={signupForm.subjects.includes(sub)}
                            onChange={(e) => {
                              const subjects = e.target.checked 
                                ? [...signupForm.subjects, sub]
                                : signupForm.subjects.filter(s => s !== sub);
                              setSignupForm({...signupForm, subjects});
                            }}
                          />
                          {sub}
                        </label>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={handleTeacherSignup}
                    className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg"
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
                  {error && <p className="text-red-500 text-sm flex items-center gap-1 justify-center"><AlertCircle className="w-4 h-4" /> {error}</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {view === 'teacher-portal' && (
            <motion.div key="teacher" className="space-y-6">
              <div className="grid md:grid-cols-3 gap-6">
                {/* Attendance Box */}
                <div 
                  onClick={() => setActiveTeacherSection(activeTeacherSection === 'attendance' ? null : 'attendance')}
                  className={`p-8 rounded-3xl cursor-pointer transition-all transform hover:scale-105 shadow-sm border-2 ${activeTeacherSection === 'attendance' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-800 border-gray-100'}`}
                >
                  <ClipboardCheck className={`w-12 h-12 mb-4 ${activeTeacherSection === 'attendance' ? 'text-white' : 'text-indigo-600'}`} />
                  <h3 className="text-2xl font-bold">Attendance</h3>
                  <p className={`text-sm mt-2 ${activeTeacherSection === 'attendance' ? 'text-indigo-100' : 'text-gray-500'}`}>Mark your daily presence</p>
                </div>

                {/* Leave Box */}
                <div 
                  onClick={() => setActiveTeacherSection(activeTeacherSection === 'leave' ? null : 'leave')}
                  className={`p-8 rounded-3xl cursor-pointer transition-all transform hover:scale-105 shadow-sm border-2 ${activeTeacherSection === 'leave' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-800 border-gray-100'}`}
                >
                  <FileText className={`w-12 h-12 mb-4 ${activeTeacherSection === 'leave' ? 'text-white' : 'text-indigo-600'}`} />
                  <h3 className="text-2xl font-bold">Leave</h3>
                  <p className={`text-sm mt-2 ${activeTeacherSection === 'leave' ? 'text-indigo-100' : 'text-gray-500'}`}>Apply for time off</p>
                </div>

                {/* Time Table Box */}
                <div 
                  onClick={() => setActiveTeacherSection(activeTeacherSection === 'timetable' ? null : 'timetable')}
                  className={`p-8 rounded-3xl cursor-pointer transition-all transform hover:scale-105 shadow-sm border-2 ${activeTeacherSection === 'timetable' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-800 border-gray-100'}`}
                >
                  <Clock className={`w-12 h-12 mb-4 ${activeTeacherSection === 'timetable' ? 'text-white' : 'text-indigo-600'}`} />
                  <h3 className="text-2xl font-bold">Time Table</h3>
                  <p className={`text-sm mt-2 ${activeTeacherSection === 'timetable' ? 'text-indigo-100' : 'text-gray-500'}`}>View your schedule</p>
                </div>
              </div>

              {/* Content Area */}
              <AnimatePresence mode="wait">
                {activeTeacherSection === 'attendance' && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                    <div className="grid lg:grid-cols-3 gap-6">
                      <Card title="Mark Attendance" icon={ClipboardCheck} className="lg:col-span-1">
                        <div className="space-y-6 py-4">
                          <p className="text-sm text-gray-500">Enter the 6-digit code provided by the administrator.</p>
                          <input 
                            type="text" maxLength={6} placeholder="000000"
                            className="w-full p-6 text-center text-5xl font-mono tracking-[0.5em] border-2 border-indigo-100 rounded-3xl focus:border-indigo-600 outline-none transition-all"
                            onChange={(e) => { if(e.target.value.length === 6) markAttendance(e.target.value); }}
                          />
                        </div>
                      </Card>

                      <Card title="Attendance History" icon={LayoutDashboard} className="lg:col-span-2">
                        <div className="space-y-6">
                          <div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl">
                            <div className="flex items-center gap-4">
                              <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-white rounded-lg transition-all shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
                              <h4 className="text-lg font-bold text-indigo-900 min-w-[150px] text-center">{format(currentMonth, 'MMMM yyyy')}</h4>
                              <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-white rounded-lg transition-all shadow-sm"><ChevronRight className="w-5 h-5" /></button>
                            </div>
                            <button 
                              onClick={() => exportToExcel(attendance.filter(a => a.teacherId === user?.uid), 'My_Attendance')}
                              className="flex items-center gap-2 text-indigo-600 font-bold px-4 py-2 hover:bg-white rounded-xl transition-all"
                            >
                              <Download className="w-5 h-5" /> Export
                            </button>
                          </div>
                          
                          <AttendanceGrid 
                            month={currentMonth} 
                            teachers={userProfile ? [userProfile] : []} 
                            attendance={allAttendance} 
                            leaves={allLeaves} 
                          />
                        </div>
                      </Card>
                    </div>
                  </motion.div>
                )}

                {activeTeacherSection === 'leave' && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                    <Card title="Apply for Leave" icon={FileText}>
                      <div className="max-w-2xl mx-auto space-y-6 py-4">
                        <div className="grid md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700">Start Date</label>
                            <input type="date" className="w-full p-3 border rounded-xl" value={leaveForm.startDate} onChange={e => setLeaveForm({...leaveForm, startDate: e.target.value})} />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700">End Date</label>
                            <input type="date" className="w-full p-3 border rounded-xl" value={leaveForm.endDate} onChange={e => setLeaveForm({...leaveForm, endDate: e.target.value})} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-gray-700">Reason</label>
                          <textarea 
                            placeholder="Please explain the reason for your leave..." className="w-full p-4 border rounded-xl h-32"
                            value={leaveForm.reason} onChange={e => setLeaveForm({...leaveForm, reason: e.target.value})}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-gray-700">Emergency Contact</label>
                          <input type="text" placeholder="Mobile Number" className="w-full p-3 border rounded-xl" value={leaveForm.mobile} onChange={e => setLeaveForm({...leaveForm, mobile: e.target.value})} />
                        </div>
                        <button onClick={submitLeave} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all">Submit Application</button>
                      </div>
                    </Card>
                  </motion.div>
                )}

                {activeTeacherSection === 'timetable' && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                    <Card title="My Schedule" icon={Clock}>
                      <div className="p-12 text-center">
                        <div className="bg-gray-50 rounded-3xl p-12 border-2 border-dashed border-gray-200">
                          <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                          <p className="text-gray-500 font-medium">Your personalized time table will be generated by the admin soon.</p>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {view === 'admin-portal' && (
            <motion.div key="admin" className="space-y-8">
              <div className="grid md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-indigo-100">
                  <p className="text-gray-500 text-sm mb-1">Active Code</p>
                  <h2 className="text-4xl font-mono font-black text-indigo-600">{attendanceCode || '------'}</h2>
                  <button onClick={generateCode} className="mt-4 w-full py-2 bg-indigo-50 text-xs font-bold text-indigo-600 rounded-xl hover:bg-indigo-100 flex items-center justify-center gap-1 transition-all">
                    <Plus className="w-4 h-4" /> Generate New
                  </button>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                  <p className="text-gray-500 text-sm mb-1">Pending Leaves</p>
                  <h2 className="text-4xl font-black text-gray-800">{leaves.filter(l => l.status === 'pending').length}</h2>
                  <p className="text-xs text-gray-400 mt-2">Requires immediate action</p>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                  <p className="text-gray-500 text-sm mb-1">Today's Attendance</p>
                  <h2 className="text-4xl font-black text-gray-800">{attendance.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).length}</h2>
                  <p className="text-xs text-gray-400 mt-2">Teachers present today</p>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                  <button 
                    onClick={() => exportToExcel(attendance, 'School_Attendance_Report')}
                    className="w-full h-full flex flex-col items-center justify-center gap-2 text-indigo-600 font-bold hover:bg-indigo-50 rounded-2xl transition-all"
                  >
                    <Download className="w-8 h-8" />
                    Export Report
                  </button>
                </div>
              </div>

              <div className="space-y-8">
                <Card title="Master Attendance Report" icon={LayoutDashboard}>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl">
                      <div className="flex items-center gap-4">
                        <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-white rounded-lg transition-all shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
                        <h4 className="text-lg font-bold text-indigo-900 min-w-[150px] text-center">{format(currentMonth, 'MMMM yyyy')}</h4>
                        <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-white rounded-lg transition-all shadow-sm"><ChevronRight className="w-5 h-5" /></button>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="hidden md:flex items-center gap-4 text-xs font-bold mr-4">
                          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-50 text-green-600 border flex items-center justify-center">P</span> Present</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-50 text-red-600 border flex items-center justify-center">A</span> Absent</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-50 text-orange-600 border flex items-center justify-center">L</span> Leave</span>
                        </div>
                        <button 
                          onClick={exportMasterAttendance}
                          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all shadow-md"
                        >
                          <Download className="w-4 h-4" /> Download Excel
                        </button>
                      </div>
                    </div>
                    
                    <AttendanceGrid 
                      month={currentMonth} 
                      teachers={allTeachers} 
                      attendance={allAttendance} 
                      leaves={allLeaves} 
                    />
                  </div>
                </Card>

                <div className="grid lg:grid-cols-2 gap-8">
                  <Card title="Arrangement & Leave Dashboard" icon={FileText}>
                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                      {leaves.length === 0 && <p className="text-center py-10 text-gray-400 italic">No leave requests found.</p>}
                      {leaves.map(leave => (
                        <div key={leave.id} className="p-5 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col gap-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-black text-indigo-900">{leave.teacherName}</p>
                              <p className="text-xs font-bold text-gray-500 flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> {leave.startDate} to {leave.endDate}
                              </p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                              leave.status === 'approved' ? 'bg-green-100 text-green-700' : 
                              leave.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                            }`}>
                              {leave.status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 bg-white p-3 rounded-xl border border-gray-100 italic">"{leave.reason}"</p>
                          
                          {leave.status === 'pending' && (
                            <div className="flex gap-3">
                              <button 
                                onClick={() => updateLeaveStatus(leave.id, 'approved')}
                                className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-all flex items-center justify-center gap-2"
                              >
                                <UserCheck className="w-4 h-4" /> Approve
                              </button>
                              <button 
                                onClick={() => updateLeaveStatus(leave.id, 'rejected')}
                                className="flex-1 py-2 bg-red-50 text-red-600 rounded-xl font-bold text-sm hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                              >
                                <UserX className="w-4 h-4" /> Reject
                              </button>
                            </div>
                          )}
                          
                          {leave.status === 'approved' && (
                            <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 flex items-center justify-between">
                              <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs">
                                <Sparkles className="w-4 h-4" /> AI Suggestion:
                              </div>
                              <span className="text-xs font-medium text-indigo-600">Substitute: Mr. Sharma (Free)</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card title="AI Time Table Manager" icon={Calendar}>
                    <div className="space-y-6">
                      <div className="bg-indigo-600 p-6 rounded-3xl text-white relative overflow-hidden">
                        <Sparkles className="absolute -right-4 -top-4 w-24 h-24 opacity-10" />
                        <h4 className="text-lg font-bold mb-2">Smart Scheduler</h4>
                        <p className="text-sm opacity-80 mb-4">Generate optimized time tables with max 6 bells per teacher.</p>
                        <button className="w-full py-3 bg-white text-indigo-600 rounded-xl font-black hover:bg-indigo-50 transition-all shadow-lg">
                          AI Generate Time Table
                        </button>
                      </div>
                      
                      <div className="space-y-4 border-t pt-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-gray-700">Manage Subjects</h4>
                          <span className="text-[10px] bg-gray-100 px-2 py-1 rounded-md text-gray-500 font-bold">ADMIN DEFINED</span>
                        </div>
                        <div className="flex gap-2">
                          <input 
                            type="text" placeholder="New Subject" className="flex-1 p-3 border rounded-xl text-sm focus:border-indigo-600 outline-none"
                            value={newSubject} onChange={e => setNewSubject(e.target.value)}
                          />
                          <button 
                            onClick={() => {
                              if (newSubject) {
                                const subjects = [...schoolSettings.subjects, newSubject];
                                setDoc(doc(db, 'settings', 'school'), { ...schoolSettings, subjects });
                                setNewSubject('');
                              }
                            }}
                            className="bg-indigo-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-indigo-700"
                          >
                            Add
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {schoolSettings.subjects.map(sub => (
                            <span key={sub} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border border-gray-200">
                              {sub}
                              <X 
                                className="w-3 h-3 cursor-pointer hover:text-red-500" 
                                onClick={() => {
                                  const subjects = schoolSettings.subjects.filter(s => s !== sub);
                                  setDoc(doc(db, 'settings', 'school'), { ...schoolSettings, subjects });
                                }}
                              />
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <button className="p-4 bg-white border-2 border-gray-100 rounded-2xl text-sm font-bold hover:border-indigo-200 hover:bg-indigo-50 transition-all flex items-center justify-center gap-2">
                          <Users className="w-4 h-4" /> Teacher List
                        </button>
                        <button className="p-4 bg-white border-2 border-gray-100 rounded-2xl text-sm font-bold hover:border-indigo-200 hover:bg-indigo-50 transition-all flex items-center justify-center gap-2">
                          <Settings className="w-4 h-4" /> Class Settings
                        </button>
                      </div>
                    </div>
                  </Card>
                </div>

                <Card title="Teacher Database" icon={Users}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left border-b text-gray-400 font-bold">
                          <th className="pb-4">Name</th>
                          <th className="pb-4">ID</th>
                          <th className="pb-4">Classes</th>
                          <th className="pb-4">Subjects</th>
                          <th className="pb-4">Total Attendance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {allTeachers.map(t => (
                          <tr key={t.uid} className="hover:bg-gray-50 transition-colors">
                            <td className="py-4 font-bold text-indigo-900">{t.name}</td>
                            <td className="py-4 text-gray-500 font-mono">{t.email.split('@')[0]}</td>
                            <td className="py-4">
                              <div className="flex gap-1">
                                {t.classes?.map(c => <span key={c} className="bg-gray-100 px-2 py-0.5 rounded text-[10px] font-bold">{c}</span>)}
                              </div>
                            </td>
                            <td className="py-4">
                              <div className="flex gap-1">
                                {t.subjects?.map(s => <span key={s} className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-bold">{s}</span>)}
                              </div>
                            </td>
                            <td className="py-4">
                              <span className="font-bold text-green-600">
                                {allAttendance.filter(a => a.teacherId === t.uid).length} Days
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
