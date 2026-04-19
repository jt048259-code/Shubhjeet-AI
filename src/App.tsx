import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

// --- Types ---
import { 
  Users, Calendar, Clock, Download, Plus, X, Search, 
  Menu, LogOut, LayoutDashboard, UserCheck, UserX, 
  FileText, Sparkles, ChevronLeft, ChevronRight, History,
  Settings, ShieldCheck, Mail, Lock, Phone, UserPlus,
  CalendarCheck, AlertCircle, Trash2, Save, Filter,
  CheckCircle2, Info, ArrowUpRight, GraduationCap, HelpCircle
} from 'lucide-react';
import { 
  initializeApp 
} from 'firebase/app';
import { 
  getFirestore, collection, onSnapshot, doc, setDoc, 
  addDoc, deleteDoc, getDoc, getDocs, updateDoc,
  query, where, orderBy, limit, serverTimestamp, getDocFromServer
} from 'firebase/firestore';
import { 
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, 
  signOut, GoogleAuthProvider, signInWithPopup,
  setPersistence, browserSessionPersistence
} from 'firebase/auth';
import { 
  format, startOfMonth, endOfMonth, eachDayOfInterval, 
  isPast, isToday, addMonths, subMonths, getDay, 
  parseISO, isAfter, startOfDay, endOfDay, addDays, subDays,
  isSameMonth, startOfYear
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { generateTimetableAI, suggestSubstitutionAI, TimetableEntry, SubjectRequirement } from './services/geminiService';
import firebaseConfig from '../firebase-applet-config.json';

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
const auth = getAuth(app);
setPersistence(auth, browserSessionPersistence);
const provider = new GoogleAuthProvider();

// Connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is reporting as offline.");
    }
  }
}
testConnection();

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let isFirestoreError = false;
      let firestoreMsg = "";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.operationType) {
          isFirestoreError = true;
          firestoreMsg = `Firestore error during ${parsed.operationType} on ${parsed.path || 'unknown path'}.`;
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-red-50 flex flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="w-16 h-16 text-red-600 mb-4" />
          <h2 className="text-2xl font-black text-red-950 mb-2">Something went wrong</h2>
          <p className="text-red-700 max-w-md mb-6">
            {isFirestoreError ? firestoreMsg : "An unexpected error occurred. Please try refreshing the page."}
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-8 py-3 rounded-2xl font-black shadow-xl shadow-red-200 hover:bg-red-700 transition-all"
          >
            REFRESH PORTAL
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Teacher {
  uid: string;
  name: string;
  mobile: string;
  email: string;
  classes: string[];
  subjects: string[];
  role: 'teacher' | 'admin';
  password?: string;
}

interface AttendanceRecord {
  id?: string;
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
  status: 'pending' | 'approved' | 'rejected';
  mobile: string;
}

interface Arrangement {
  id?: string;
  date: string; // ISO Date YYYY-MM-DD
  substitutions: {
    absentTeacherId: string;
    absentTeacherName: string;
    period: number;
    class: string;
    subject: string;
    substituteId: string | 'UNASSIGNED';
    substituteName: string;
  }[];
  createdAt: string;
}

interface StudentAttendance {
  id?: string;
  date: string;
  class: string;
  totalStudents: number;
  present: number;
  absent: number;
  recordedBy: string; // Teacher UID
  recordedByName: string;
}

interface Holiday {
  id?: string;
  date: string;
  reason: string;
}

interface SchoolSettings {
  subjects: string[];
  classes: string[];
}

// --- Constants ---
const ALL_CLASSES_STRUCTURE = [
  { level: '6', sections: ['A', 'B', 'C'] },
  { level: '7', sections: ['A', 'B', 'C'] },
  { level: '8', sections: ['A', 'B', 'C'] },
  { level: '9', sections: ['A', 'B', 'C', 'D', 'E'] },
  { level: '10', sections: ['A', 'B', 'C', 'D'] },
  { level: '11', sections: ['A', 'B', 'C', 'D', 'E'] },
  { level: '12', sections: ['A', 'B', 'C', 'D', 'E'] },
];

const FLattenClasses = ALL_CLASSES_STRUCTURE.flatMap(c => c.sections.map(s => `${c.level}${s}`));

// --- Components ---

const Card = ({ title, children, icon: Icon, className = "", headerAction }: any) => (
  <div className={`bg-white rounded-3xl shadow-xl shadow-indigo-100/50 border border-indigo-50/50 overflow-hidden ${className}`}>
    <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-indigo-900 px-6 py-4 flex justify-between items-center">
      <div className="flex items-center gap-3">
        {Icon && <Icon className="w-5 h-5 text-indigo-300" />}
        <h3 className="font-black text-white tracking-wide uppercase text-sm">{title}</h3>
      </div>
      {headerAction}
    </div>
    <div className="p-6">{children}</div>
  </div>
);

const AttendanceGrid = ({ month, teachers, attendance, leaves, holidays }: {
  month: Date;
  teachers: Teacher[];
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  holidays: Holiday[];
}) => {
  const days = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month)
  });

  const getStatus = (teacherId: string, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const isSunday = getDay(date) === 0;
    const holiday = holidays.find(h => h.date === dateStr);

    if (isSunday || holiday) return { char: 'H', color: 'bg-blue-50 text-blue-600', reason: holiday?.reason || 'Sunday' };

    const present = attendance.some(a => a.teacherId === teacherId && a.date === dateStr);
    if (present) return { char: 'P', color: 'bg-green-50 text-green-600' };

    const leave = leaves.find(l => 
      l.teacherId === teacherId && 
      l.status === 'approved' && 
      dateStr >= l.startDate && 
      dateStr <= l.endDate
    );
    if (leave) return { char: 'L', color: 'bg-orange-50 text-orange-600', reason: leave.reason };

    if (isPast(date) && !isToday(date)) return { char: 'A', color: 'bg-red-50 text-red-600' };

    return { char: '', color: '' };
  };

  return (
    <div className="overflow-x-auto border-2 border-indigo-50/50 rounded-2xl shadow-sm">
      <table className="w-full text-[10px] border-collapse">
        <thead className="bg-indigo-50/50">
          <tr>
            <th className="p-3 text-left font-black text-indigo-900 border-b border-r sticky left-0 bg-indigo-50/50 z-10 w-40">TEACHER NAME</th>
            {days.map(d => (
              <th key={d.toISOString()} className={`p-2 font-bold text-center border-b border-r min-w-[35px] ${getDay(d) === 0 ? 'bg-red-50/50' : ''}`}>
                <div className="flex flex-col opacity-75">
                  <span className="text-[8px] uppercase">{format(d, 'EEE')}</span>
                  <span className="text-sm">{format(d, 'd')}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teachers.length === 0 && (
            <tr><td colSpan={days.length + 1} className="p-10 text-center text-gray-400 italic">No teachers found.</td></tr>
          )}
          {teachers.map(t => (
            <tr key={t.uid} className="hover:bg-indigo-50/30 transition-colors">
              <td className="p-3 border-b border-r font-bold text-gray-800 sticky left-0 bg-white z-10">{t.name}</td>
              {days.map(d => {
                const status = getStatus(t.uid, d);
                return (
                  <td 
                    key={d.toISOString()} 
                    title={status.reason}
                    className={`p-2 border-b border-r text-center font-black ${status.color} ${getDay(d) === 0 ? 'bg-red-50/20' : ''}`}
                  >
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

// --- Main App Component ---

export default function App() {
  const [view, setView] = useState<'home' | 'loginSelection' | 'teacherLogin' | 'adminLogin' | 'teacherPortal' | 'adminPortal' | 'teacherSignUp'>('home');
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);

  // States
  const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [studentAttendance, setStudentAttendance] = useState<StudentAttendance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [schoolSettings, setSchoolSettings] = useState<SchoolSettings>({ subjects: [], classes: [] });
  const [subjectRequirements, setSubjectRequirements] = useState<SubjectRequirement[]>([]);

  const [activeAdminSection, setActiveAdminSection] = useState<'dashboard' | 'attendance' | 'arrangement' | 'teachers' | 'timetable' | 'students'>('dashboard');
  const [activeArrangementTab, setActiveArrangementTab] = useState<'view' | 'generate' | 'leaves'>('generate');
  const [arrangementDate, setArrangementDate] = useState<Date>(new Date());
  const [activeTimetableSubSection, setActiveTimetableSubSection] = useState<'view' | 'generate'>('view');
  const [timetableViewState, setTimetableViewState] = useState<'teacher' | 'class'>('teacher');
  const [activeTimetableView, setActiveTimetableView] = useState<'teacher' | 'class'>('teacher');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Form States
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [attendanceCode, setAttendanceCode] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [substitutionSuggestions, setSubstitutionSuggestions] = useState<any[]>([]);
  const [showAllLeaves, setShowAllLeaves] = useState(false);

  // --- Auth Handlers ---

  useEffect(() => {
    if (userProfile && (view === 'loginSelection' || view === 'adminLogin' || view === 'teacherLogin' || view === 'teacherSignUp')) {
      setView(userProfile.role === 'admin' ? 'adminPortal' : 'teacherPortal');
    }
  }, [userProfile, view]);

  useEffect(() => {
    // Public settings fetchers
    const unsubSettings = onSnapshot(doc(db, 'settings', 'school'), 
      (snap) => {
        if (snap.exists()) setSchoolSettings(snap.data() as SchoolSettings);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'settings/school')
    );

    const unsubTimetable = onSnapshot(doc(db, 'settings', 'timetable'), 
      (snap) => {
        if (snap.exists()) setTimetable(snap.data().entries || []);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'settings/timetable')
    );

    return () => {
      unsubSettings();
      unsubTimetable();
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (snap.exists()) {
            const profile = snap.data() as Teacher;
            setUserProfile(profile);
            // Don't auto-redirect to portal on load if user wants landing page first
            // setView(profile.role === 'admin' ? 'adminPortal' : 'teacherPortal');
          } else if (u.email === 'jitendrakumart557@gmail.com' || u.email === 'admin@ssm.portal') {
            const profile: Teacher = {
              uid: u.uid,
              name: u.email === 'admin@ssm.portal' ? 'SSM Admin' : 'Master Admin',
              email: u.email!,
              mobile: '0000000000',
              classes: [],
              subjects: [],
              role: 'admin'
            };
            await setDoc(doc(db, 'users', u.uid), profile);
            setUserProfile(profile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        }
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setLoginLoading(true);
      const res = await signInWithPopup(auth, provider);
      const profileSnap = await getDoc(doc(db, 'users', res.user.uid));
      if (profileSnap.exists()) {
        const profile = profileSnap.data() as Teacher;
        setUserProfile(profile);
        setView(profile.role === 'admin' ? 'adminPortal' : 'teacherPortal');
      } else {
        // If it's a new google user, we check if they should be admin
        if (res.user.email === 'jitendrakumart557@gmail.com' || res.user.email === 'admin@ssm.portal') {
          const profile: Teacher = {
            uid: res.user.uid,
            name: res.user.displayName || 'SSM Admin',
            email: res.user.email,
            mobile: '0000000000',
            classes: [],
            subjects: [],
            role: 'admin'
          };
          await setDoc(doc(db, 'users', res.user.uid), profile);
          setUserProfile(profile);
          setView('adminPortal');
        } else {
          // New teacher via google - they need to complete registration
          const profile: Teacher = {
            uid: res.user.uid,
            name: res.user.displayName || '',
            email: res.user.email!,
            mobile: '',
            classes: [],
            subjects: [],
            role: 'teacher'
          };
          setUserProfile(profile);
          setView('teacherSignUp' as any);
        }
      }
    } catch (err: any) {
      alert("Google Login Error: " + err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const [loginLoading, setLoginLoading] = useState(false);

  const handleLogout = async () => {
    await signOut(auth);
    setView('home');
    setUserProfile(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    console.log("Attempting login for view:", view);
    
    if (view === 'adminLogin') {
      const inputId = loginForm.email?.trim().toUpperCase();
      console.log("Admin ID Input:", inputId);
      
      if (inputId === 'SSM100728' && loginForm.password.trim() === '9923123') {
        const adminEmail = 'admin@ssm.portal';
        const adminPass = '9923123';
        try {
          console.log("Authenticating admin...");
          const res = await signInWithEmailAndPassword(auth, adminEmail, adminPass);
          console.log("Admin authenticated, fetching profile...");
          let profileSnap = await getDoc(doc(db, 'users', res.user.uid));
          let profileData: Teacher;
          
          if (!profileSnap.exists()) {
            console.log("Admin profile missing, creating...");
            profileData = {
              uid: res.user.uid,
              name: 'SSM Admin',
              email: adminEmail,
              mobile: '0000000000',
              classes: [],
              subjects: [],
              role: 'admin'
            };
            await setDoc(doc(db, 'users', res.user.uid), profileData);
          } else {
            console.log("Admin profile found.");
            profileData = profileSnap.data() as Teacher;
            if (profileData.role !== 'admin') {
              profileData.role = 'admin';
              await updateDoc(doc(db, 'users', res.user.uid), { role: 'admin' });
            }
          }
          
          setUserProfile(profileData);
          setView('adminPortal');
          console.log("Admin portal view set.");
        } catch (err: any) {
          console.error("Admin login error:", err);
          // Catch both old and new Firebase Auth error codes for 'not found' / 'invalid'
          if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials') {
            console.log("Admin account not found or invalid, attempting to create/reset...");
            try {
              const { createUserWithEmailAndPassword } = await import('firebase/auth');
              const res = await createUserWithEmailAndPassword(auth, adminEmail, adminPass);
              const profile: Teacher = {
                uid: res.user.uid,
                name: 'SSM Admin',
                email: adminEmail,
                mobile: '0000000000',
                classes: [],
                subjects: [],
                role: 'admin'
              };
              await setDoc(doc(db, 'users', res.user.uid), profile);
              setUserProfile(profile);
              setView('adminPortal');
            } catch (regErr: any) {
              // If user already exists but password was wrong, we can't easily fix it without admin SDK or reset email
              // But for this sandbox, we usually want to ensure the account works.
              if (regErr.code === 'auth/email-already-in-use') {
                alert("The Admin account already exists with a different password. Please contact support or reset password.");
              } else {
                alert("Admin Access Error: " + regErr.message);
              }
            }
          } else {
            alert("Admin Login Error: " + err.message);
          }
        } finally {
          setLoginLoading(false);
        }
        return;
      } else {
        alert("Invalid Admin ID or Password. Check credentials.");
        setLoginLoading(false);
        return;
      }
    }

    try {
      console.log("Authenticating teacher:", loginForm.email);
      const res = await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
      const profileSnap = await getDoc(doc(db, 'users', res.user.uid));
      if (profileSnap.exists()) {
        const profile = profileSnap.data() as Teacher;
        setUserProfile(profile);
        setView(profile.role === 'admin' ? 'adminPortal' : 'teacherPortal');
        console.log("Teacher logged in, role:", profile.role);
      } else {
        alert("Profile not found. Please register first.");
      }
    } catch (err: any) {
      console.error("Teacher login error:", err);
      alert("Login Error: " + err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  useEffect(() => {
    if (userProfile?.role !== 'admin' || leaves.length === 0) return;

    const checkExpiredLeaves = async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const expired = leaves.filter(l => l.status === 'pending' && l.startDate < today);
      
      for (const leave of expired) {
        try {
          await updateDoc(doc(db, 'leaves', leave.id), { status: 'rejected' });
        } catch (e) {
          console.error("Auto-reject error", e);
        }
      }
    };
    checkExpiredLeaves();
  }, [leaves, userProfile]);

  useEffect(() => {
    if (!user || (userProfile?.role !== 'admin' && userProfile?.role !== 'teacher')) return;

    const unsubTeachers = userProfile?.role === 'admin' 
      ? onSnapshot(collection(db, 'users'), 
          (snap) => {
            const users = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as Teacher));
            // Filter out admins from being treated as teachers
            setAllTeachers(users.filter(u => u.role !== 'admin' && !u.email?.includes('admin') && u.name !== 'SSM Admin' && u.name !== 'Master Admin' && u.name !== 'Jitendra Kumar Tripathi'));
          },
          (error) => handleFirestoreError(error, OperationType.LIST, 'users')
        )
      : null;

    const unsubAttendance = onSnapshot(
      userProfile?.role === 'admin' 
        ? collection(db, 'attendance') 
        : query(collection(db, 'attendance'), where('teacherId', '==', user.uid)), 
      (snap) => {
        setAttendance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceRecord)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'attendance')
    );

    const unsubLeaves = onSnapshot(
      userProfile?.role === 'admin' 
        ? collection(db, 'leaves') 
        : query(collection(db, 'leaves'), where('teacherId', '==', user.uid)), 
      (snap) => {
        setLeaves(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LeaveRequest)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'leaves')
    );

    const unsubArrangements = onSnapshot(collection(db, 'arrangements'), 
      (snap) => {
        setArrangements(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Arrangement)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'arrangements')
    );

    const unsubStudentAtt = onSnapshot(collection(db, 'studentAttendance'), 
      (snap) => {
        setStudentAttendance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StudentAttendance)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'studentAttendance')
    );

    const unsubHolidays = onSnapshot(collection(db, 'holidays'), 
      (snap) => {
        setHolidays(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Holiday)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'holidays')
    );

    const unsubRequirements = onSnapshot(doc(db, 'settings', 'subjectRequirements'), 
      (snap) => {
        if (snap.exists()) setSubjectRequirements(snap.data().requirements || []);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'settings/subjectRequirements')
    );

    const unsubCode = onSnapshot(query(collection(db, 'attendanceCodes'), orderBy('createdAt', 'desc'), limit(1)), 
      (snap) => {
        if (!snap.empty) {
          const data = snap.docs[0].data();
          if (isAfter(new Date(data.expiresAt), new Date())) {
            setAttendanceCode(data.code);
          } else {
            setAttendanceCode(null);
          }
        }
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'attendanceCodes')
    );

    return () => {
      unsubTeachers?.();
      unsubAttendance();
      unsubLeaves();
      unsubArrangements();
      unsubStudentAtt();
      unsubHolidays();
      unsubRequirements();
      unsubCode();
    };
  }, [user, userProfile]);

  // --- Admin Logic ---

  const markTodayAsHoliday = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const isSunday = getDay(new Date()) === 0;
    const defaultReason = isSunday ? 'Sunday' : 'Public Holiday';
    
    // Use a simple prompt but handle it better
    const reason = window.prompt("Enter holiday reason:", defaultReason);
    if (!reason && reason !== "") return;

    try {
      const holidayReason = reason || defaultReason;
      await setDoc(doc(db, 'holidays', today), {
        date: today,
        reason: holidayReason
      });
      alert(`Holiday "${holidayReason}" Marked for Today!`);
    } catch (err) {
      console.error("Holiday Error:", err);
      alert("Error marking holiday. Please check connection.");
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
        const isSun = getDay(day) === 0;
        const holiday = holidays.find(h => h.date === dateStr);

        if (isSun || holiday) {
          row[format(day, 'd')] = holiday?.reason || 'Sunday';
        } else {
          const att = attendance.some(a => a.teacherId === teacher.uid && a.date === dateStr);
          const leave = leaves.some(l => l.teacherId === teacher.uid && l.status === 'approved' && dateStr >= l.startDate && dateStr <= l.endDate);
          
          let val = '';
          if (att) val = 'P';
          else if (leave) val = 'L';
          else if (isPast(day)) val = 'A';
          row[format(day, 'd')] = val;
        }
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `Master_Attendance_${format(currentMonth, 'MMM_yyyy')}.xlsx`);
  };

  const exportTeacherAttendance = () => {
    if (!userProfile) return;
    const sessionStr = `${new Date().getFullYear()}-${(new Date().getFullYear() + 1).toString().slice(-2)}`;
    
    // Get all days from start of year to now
    const days = eachDayOfInterval({
      start: startOfYear(new Date()),
      end: new Date()
    });

    const data = days.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const isSun = getDay(day) === 0;
      const holiday = holidays.find(h => h.date === dateStr);
      
      let status = 'Absent';
      if (isSun) status = 'Sunday';
      else if (holiday) status = holiday.reason;
      else {
        const att = attendance.some(a => a.teacherId === userProfile.uid && a.date === dateStr);
        const leave = leaves.some(l => l.teacherId === userProfile.uid && l.status === 'approved' && dateStr >= l.startDate && dateStr <= l.endDate);
        if (att) status = 'Present';
        else if (leave) status = 'Leave';
      }

      return {
        Date: dateStr,
        Day: format(day, 'EEEE'),
        Status: status
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `${userProfile.name}_Attendance_${sessionStr}.xlsx`);
  };

  const handleGenerateTimetable = async () => {
    if (subjectRequirements.length === 0) {
      alert("Please set subject requirements first.");
      return;
    }
    setLoadingAI(true);
    try {
      const teachersData = allTeachers.map(t => ({
        uid: t.uid,
        name: t.name,
        subjects: t.subjects,
        classes: t.classes
      }));
      
      const newTimetable = await generateTimetableAI(teachersData, subjectRequirements);
      await setDoc(doc(db, 'settings', 'timetable'), { entries: newTimetable });
      alert("Timetable generated successfully!");
    } catch (err) {
      console.error(err);
      alert("AI Generation failed. Please check requirements and try again.");
    } finally {
      setLoadingAI(false);
    }
  };

  const updateRequirement = async (req: SubjectRequirement) => {
    const updated = [...subjectRequirements];
    const idx = updated.findIndex(r => r.class === req.class && r.section === req.section && r.subject === req.subject);
    if (idx > -1) updated[idx] = req;
    else updated.push(req);
    await setDoc(doc(db, 'settings', 'subjectRequirements'), { requirements: updated });
  };

  const handleAISubstitution = async (leave: LeaveRequest) => {
    setLoadingAI(true);
    try {
      const today = leave.startDate; // Assume suggesting for start date
      const dayName = format(parseISO(today), 'EEEE');
      const teacherTimetable = timetable.filter(t => t.teacherId === leave.teacherId && t.day === dayName);
      
      const absentTeacher = {
        name: leave.teacherName,
        schedule: teacherTimetable.map(t => ({ bell: t.bell, class: `${t.class}${t.section}` }))
      };

      const freeTeachers = allTeachers
        .filter(t => t.uid !== leave.teacherId && !attendance.some(a => a.teacherId === t.uid && a.date === today)) // simple logic: present teachers
        .map(t => ({
          uid: t.uid,
          name: t.name,
          schedule: timetable.filter(entry => entry.teacherId === t.uid && entry.day === dayName).map(e => ({ bell: e.bell, class: `${e.class}${e.section}` }))
        }));

      const suggestions = await suggestSubstitutionAI(
        { name: leave.teacherName, subjects: [], classes: [] },
        freeTeachers.map(ft => ({ ...ft, subjects: [], classes: [] })),
        timetable.filter(t => t.day === dayName)
      );
      setSubstitutionSuggestions(suggestions);
    } catch (err) {
      alert("AI Suggestion failed.");
    } finally {
      setLoadingAI(false);
    }
  };

  const exportTimetable = (type: 'teacher' | 'class') => {
    const daysArr = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const wb = XLSX.utils.book_new();
    
    if (type === 'teacher') {
      const data = allTeachers.map(teacher => {
        const row: any = { 'Teacher Name': teacher.name };
        daysArr.forEach(day => {
          const dayEntries = timetable
            .filter(t => t.teacherId === teacher.uid && t.day === day)
            .sort((a,b) => a.bell - b.bell)
            .map(t => `B${t.bell}:${t.class}${t.section}(${t.subject})`)
            .join(' | ');
          row[day] = dayEntries || 'FREE';
        });
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "Teacher Timetable");
    } else {
      const classes = [...new Set(timetable.map(t => `${t.class}${t.section}`))].sort();
      const data = classes.map(cls => {
        const row: any = { 'Class': cls };
        daysArr.forEach(day => {
          const dayEntries = timetable
            .filter(t => `${t.class}${t.section}` === cls && t.day === day)
            .sort((a,b) => a.bell - b.bell)
            .map(t => `B${t.bell}:${t.subject}(${allTeachers.find(at => at.uid === t.teacherId)?.name || 'N/A'})`)
            .join(' | ');
          row[day] = dayEntries || '-';
        });
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "Class Timetable");
    }
    
    XLSX.writeFile(wb, `SSM_Timetable_${type}_wise.xlsx`);
  };

  // --- Sub-Components for Admin ---

  const TimetableSection = () => {
    const daysArr = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return (
      <Card title="Time Table Management" icon={Clock} headerAction={
        <div className="flex gap-2 bg-indigo-950/50 p-1 rounded-xl">
          <button onClick={() => setActiveTimetableSubSection('view')} className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${activeTimetableSubSection === 'view' ? 'bg-indigo-600 text-white shadow-lg' : 'text-indigo-300 hover:bg-white/10'}`}>VIEW</button>
          <button onClick={() => setActiveTimetableSubSection('generate')} className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${activeTimetableSubSection === 'generate' ? 'bg-indigo-600 text-white shadow-lg' : 'text-indigo-300 hover:bg-white/10'}`}>GENERATE</button>
        </div>
      }>
        {activeTimetableSubSection === 'view' ? (
          <div className="space-y-6">
            <div className="flex justify-center gap-4">
              <button 
                onClick={() => setTimetableViewState('teacher')}
                className={`flex items-center gap-2 px-6 py-2 rounded-2xl font-bold text-xs transition-all ${timetableViewState === 'teacher' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
              >
                <Users className="w-4 h-4" /> Teacher-wise
              </button>
              <button 
                onClick={() => setTimetableViewState('class')}
                className={`flex items-center gap-2 px-6 py-2 rounded-2xl font-bold text-xs transition-all ${timetableViewState === 'class' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
              >
                <GraduationCap className="w-4 h-4" /> Class-wise
              </button>
            </div>

            <div className="overflow-x-auto border-2 border-indigo-50/50 rounded-2xl p-4 bg-white">
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-xl font-black text-indigo-950 uppercase tracking-tighter">Current Schedule</h4>
                <button 
                  onClick={() => exportTimetable(timetableViewState)}
                  className="bg-green-600 text-white px-6 py-2.5 rounded-2xl font-black text-[10px] tracking-widest flex items-center gap-2 hover:bg-green-700 transition-all shadow-xl shadow-green-100 uppercase"
                >
                  <Download className="w-4 h-4" /> Export {timetableViewState}-wise Excel
                </button>
              </div>

              {timetableViewState === 'teacher' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead className="bg-indigo-50/50">
                      <tr>
                        <th className="p-3 text-left font-black border-b border-r sticky left-0 bg-indigo-50/50 z-10 transition-colors">Teacher</th>
                        {daysArr.map(day => (
                          <th key={day} className="p-2 border-b border-r text-center font-black min-w-[140px] uppercase text-indigo-600">{day}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allTeachers.map(teacher => (
                        <tr key={teacher.uid} className="hover:bg-indigo-50/30 group">
                          <td className="p-3 border-b border-r font-black sticky left-0 bg-white z-10 group-hover:bg-indigo-50/30">{teacher.name}</td>
                          {daysArr.map(day => (
                            <td key={day} className="p-1 border-b border-r align-top">
                              <div className="space-y-1">
                                {timetable.filter(e => e.teacherId === teacher.uid && e.day === day).sort((a,b) => a.bell - b.bell).map((entry, idx) => (
                                  <div key={idx} className="p-2 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                                    <p className="font-black text-indigo-900 leading-none mb-1 text-[9px]">BELL {entry.bell}</p>
                                    <p className="font-black text-indigo-600 leading-none">{entry.class}{entry.section}</p>
                                    <p className="text-[8px] opacity-60 font-bold uppercase mt-1 line-clamp-1">{entry.subject}</p>
                                  </div>
                                ))}
                                {timetable.filter(e => e.teacherId === teacher.uid && e.day === day).length === 0 && (
                                  <div className="py-2 text-center opacity-10 text-[8px] font-black uppercase">Free</div>
                                )}
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead className="bg-indigo-50/50">
                      <tr>
                        <th className="p-3 text-left font-black border-b border-r sticky left-0 bg-indigo-50/50 z-10 transition-colors">Class</th>
                        {daysArr.map(day => (
                          <th key={day} className="p-2 border-b border-r text-center font-black min-w-[140px] uppercase text-indigo-600">{day}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {FLattenClasses.map(cls => (
                        <tr key={cls} className="hover:bg-indigo-50/30 group">
                          <td className="p-3 border-b border-r font-black sticky left-0 bg-white z-10 group-hover:bg-indigo-50/30 text-center">Class {cls}</td>
                          {daysArr.map(day => {
                            const level = cls.slice(0, -1);
                            const section = cls.slice(-1);
                            return (
                              <td key={day} className="p-1 border-b border-r align-top">
                                <div className="space-y-1">
                                  {timetable.filter(e => e.class === level && e.section === section && e.day === day).sort((a,b) => a.bell - b.bell).map((entry, idx) => (
                                    <div key={idx} className="p-2 bg-orange-50/50 rounded-xl border border-orange-100/50">
                                      <p className="font-black text-orange-900 leading-none mb-1 text-[9px]">BELL {entry.bell}</p>
                                      <p className="font-black text-orange-600 leading-none">{entry.subject}</p>
                                      <p className="text-[8px] opacity-60 font-bold uppercase mt-1 line-clamp-1">{allTeachers.find(at => at.uid === entry.teacherId)?.name || 'N/A'}</p>
                                    </div>
                                  ))}
                                  {timetable.filter(e => e.class === level && e.section === section && e.day === day).length === 0 && (
                                    <div className="py-2 text-center opacity-10 text-[8px] font-black uppercase">-</div>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-indigo-600 p-8 rounded-3xl text-white relative overflow-hidden">
              <Sparkles className="absolute -right-6 -top-6 w-32 h-32 opacity-10" />
              <h4 className="text-xl font-bold mb-2">Master AI Generator</h4>
              <p className="text-sm opacity-90 mb-6">Generates optimized timetable based on teacher expertise and class requirements.</p>
              <div className="flex items-center gap-4">
                <button 
                  onClick={handleGenerateTimetable}
                  disabled={loadingAI}
                  className="bg-white text-indigo-600 px-8 py-3 rounded-2xl font-black text-sm hover:translate-y-[-2px] transition-all shadow-xl shadow-indigo-900/20 disabled:opacity-50"
                >
                  {loadingAI ? 'PROCESSING...' : 'GENERATE NEW TIMETABLE'}
                </button>
                <div className="flex flex-col text-[10px] opacity-70">
                  <span>• 8 Bells per Class</span>
                  <span>• Max 6 Bells per Teacher</span>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h5 className="font-bold text-indigo-950 px-2 flex items-center gap-2">
                  <Settings className="w-4 h-4" /> Class Requirements
                </h5>
                <div className="grid gap-4 max-h-[600px] overflow-y-auto pr-2">
                  {ALL_CLASSES_STRUCTURE.map(level => (
                    <div key={level.level} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                      <p className="text-sm font-black text-gray-800 mb-3 underline decoration-indigo-400">CLASS {level.level}</p>
                      <div className="space-y-4">
                        {level.sections.map(section => (
                          <div key={section} className="bg-white p-3 rounded-xl border border-indigo-50 shadow-sm">
                            <p className="text-xs font-bold text-indigo-600 mb-2">Section {section}</p>
                            <div className="flex flex-wrap gap-2">
                              {schoolSettings.subjects.map(sub => {
                                const req = subjectRequirements.find(r => r.class === level.level && r.section === section && r.subject === sub);
                                return (
                                  <div key={sub} className="bg-gray-50 px-2 py-1 rounded-lg border flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-gray-500">{sub}</span>
                                    <input 
                                      type="number" min="0" max="10"
                                      className="w-8 text-[10px] font-black text-center bg-white border-b-2 border-indigo-200 outline-none"
                                      value={req?.frequencyPerWeek || 0}
                                      onChange={(e) => updateRequirement({ 
                                        class: level.level, 
                                        section, 
                                        subject: sub, 
                                        frequencyPerWeek: parseInt(e.target.value) || 0 
                                      })}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h5 className="font-bold text-indigo-950 px-2 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Global Settings
                </h5>
                <Card title="Subjects & Classes" icon={Settings} className="!p-0 border-0 shadow-none">
                  <div className="space-y-6">
                    <div>
                      <h6 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Define Subjects</h6>
                      <div className="flex gap-2 mb-4">
                        <input id="sub-in" type="text" placeholder="e.g. Sanskrit" className="flex-1 px-4 py-2 bg-gray-50 border rounded-xl text-xs outline-none focus:border-indigo-600 transition-all"/>
                        <button 
                          onClick={() => {
                            const input = document.getElementById('sub-in') as HTMLInputElement;
                            if (input.value) {
                              const updated = { ...schoolSettings, subjects: [...schoolSettings.subjects, input.value] };
                              setDoc(doc(db, 'settings', 'school'), updated);
                              input.value = '';
                            }
                          }}
                          className="px-4 bg-indigo-600 text-white rounded-xl text-xs font-bold"
                        >ADD</button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {schoolSettings.subjects.map(s => (
                          <span key={s} className="px-3 py-1 bg-white border border-indigo-100 rounded-full text-[10px] font-bold text-indigo-700 flex items-center gap-2">
                            {s} <X className="w-3 h-3 cursor-pointer hover:text-red-500" onClick={() => setDoc(doc(db, 'settings', 'school'), { ...schoolSettings, subjects: schoolSettings.subjects.filter(sub => sub !== s) })} />
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}
      </Card>
    );
  };

  if (loading) return (
    <div className="min-h-screen bg-indigo-950 flex flex-col items-center justify-center gap-4">
      <div className="w-16 h-16 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-indigo-300 font-bold tracking-widest text-sm animate-pulse uppercase">Syncing SSM Portal...</p>
    </div>
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8FAFF] font-sans text-gray-900 pb-20 overflow-x-hidden">
        {/* Navigation */}
        <nav className="bg-white border-b border-indigo-50 sticky top-0 z-50 backdrop-blur-md bg-white/80">
          <div className="max-w-7xl mx-auto px-6 h-20 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-600/30">
                <GraduationCap className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-xl font-black text-indigo-950 leading-tight">S.S.M Sr. Sec. School, SURYAKUND</h1>
                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest text-center">TEACHER MANAGEMENT PORTAL</p>
              </div>
            </div>
            
            {userProfile && (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setView(userProfile.role === 'admin' ? 'adminPortal' : 'teacherPortal')}
                  className="hidden sm:flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 hover:text-white transition-all"
                >
                  <LayoutDashboard className="w-4 h-4" /> Dashboard
                </button>
                <div className="hidden md:block text-right">
                  <p className="text-sm font-black text-indigo-950">{userProfile.name}</p>
                  <p className="text-[10px] font-bold text-indigo-400 uppercase">{userProfile.role}</p>
                </div>
                <button 
                  onClick={() => {
                    if (window.confirm("Are you sure you want to logout?")) {
                      handleLogout();
                    }
                  }}
                  className="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-sm"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </nav>

        <div className="max-w-7xl mx-auto px-6 py-8">
          <AnimatePresence mode="wait">
            {/* ... rest of the component ... */}
          {view === 'home' && (
            <motion.div key="home" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} className="space-y-16 py-12">
              <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
                <div className="mb-8 relative">
                  <div className="absolute -inset-10 bg-indigo-600/10 rounded-full blur-3xl"></div>
                  <GraduationCap className="w-24 h-24 text-indigo-600 relative" />
                </div>
                <h2 className="text-4xl md:text-6xl font-black text-indigo-950 mb-4 tracking-tighter uppercase">S.S.M Sr. Sec. School, SURYAKUND</h2>
                <h3 className="text-xl md:text-2xl font-bold text-indigo-600 mb-8 uppercase tracking-widest">Teacher Management Portal</h3>
                
                <div className="flex flex-col md:flex-row gap-6 w-full max-w-md mx-auto mb-16">
                  <button 
                    onClick={() => {
                      if (userProfile) {
                        setView(userProfile.role === 'admin' ? 'adminPortal' : 'teacherPortal');
                      } else {
                        setView('loginSelection');
                      }
                    }}
                    className="flex-1 bg-indigo-600 text-white px-8 py-5 rounded-3xl font-black text-lg hover:bg-indigo-700 hover:shadow-2xl hover:shadow-indigo-600/20 hover:-translate-y-1 transition-all flex items-center justify-center gap-3"
                  >
                    LOGIN TO PORTAL <ArrowUpRight className="w-6 h-6" />
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-12 text-left mt-12">
                  <div className="bg-white p-8 rounded-[2rem] border border-indigo-50 shadow-sm">
                    <h4 className="text-xl font-black text-indigo-950 mb-4 flex items-center gap-2">
                       <Info className="w-5 h-5 text-indigo-600" /> About the Portal
                    </h4>
                    <p className="text-gray-600 leading-relaxed">
                      S.S.M Digital is a comprehensive Teacher Management solution designed specifically for S.S.M Sr. Sec. School, SURYAKUND. It streamlines attendance, timetable generation, and substitution arrangements, allowing educators to focus more on teaching and less on paperwork.
                    </p>
                  </div>
                  <div className="bg-white p-8 rounded-[2rem] border border-indigo-50 shadow-sm">
                    <h4 className="text-xl font-black text-indigo-950 mb-4 flex items-center gap-2">
                       <HelpCircle className="w-5 h-5 text-indigo-600" /> How to use?
                    </h4>
                    <ul className="text-gray-600 space-y-3 list-disc pl-5">
                      <li>Teachers must register using their mobile number and assigned classes.</li>
                      <li>Use the daily attendance code provided by the Admin to mark your presence.</li>
                      <li>Check your dashboard for any substitution arrangements assigned to you.</li>
                      <li>Admins can manage the master timetable and approve leave requests.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'loginSelection' && (
             <motion.div key="sel" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }} className="max-w-4xl mx-auto space-y-12">
               <div className="text-center">
                 <button onClick={() => setView('home')} className="mb-8 text-indigo-400 font-bold hover:text-indigo-600 flex items-center gap-2 mx-auto uppercase text-xs tracking-widest"><ChevronLeft className="w-4 h-4"/> Go Back</button>
                 <h2 className="text-4xl font-black text-indigo-950">Select Your Responsibility</h2>
               </div>
               <div className="grid md:grid-cols-2 gap-8">
                 {[
                   { id: 'teacherLogin', icon: Users, label: 'Teacher', desc: 'Manage your classes, students, and leaves.', color: 'indigo' },
                   { id: 'adminLogin', icon: ShieldCheck, label: 'Administrator', desc: 'Complete school control and master scheduler.', color: 'indigo' }
                 ].map(role => (
                   <button 
                    key={role.id}
                    onClick={() => setView(role.id as any)}
                    className="bg-white p-10 rounded-[2.5rem] border-2 border-indigo-50 hover:border-indigo-600 hover:shadow-2xl transition-all group text-left relative overflow-hidden"
                   >
                     <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/5 -mr-10 -mt-10 rounded-full group-hover:bg-indigo-600 group-hover:scale-150 transition-all duration-500"></div>
                     <role.icon className="w-16 h-16 text-indigo-600 mb-6 group-hover:text-white relative" />
                     <h3 className="text-2xl font-black text-indigo-950 mb-2 relative group-hover:text-indigo-950 transition-all">{role.label}</h3>
                     <p className="text-gray-500 font-medium relative">{role.desc}</p>
                   </button>
                 ))}
               </div>
             </motion.div>
          )}

          {(view === 'teacherLogin' || view === 'adminLogin') && (
            <motion.div key="log" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto">
              <button onClick={() => setView('loginSelection')} className="mb-6 text-indigo-400 font-bold flex items-center gap-2 uppercase text-[10px] tracking-widest"><ChevronLeft className="w-3 h-3"/> Choose Role</button>
              <Card title={`${view === 'adminLogin' ? 'Admin' : 'Teacher'} Secure Access`}>
                <form onSubmit={handleLogin} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-400 uppercase ml-2">{view === 'adminLogin' ? 'Admin ID' : 'Official Email'}</label>
                    <div className="relative">
                      {view === 'adminLogin' ? <ShieldCheck className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" /> : <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />}
                      <input 
                        type={view === 'adminLogin' ? 'text' : 'email'} required placeholder={view === 'adminLogin' ? 'SSMXXXXXX' : 'name@ssm.portal'} 
                        className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-indigo-50 rounded-2xl outline-none focus:border-indigo-600 transition-all font-bold"
                        value={loginForm.email} onChange={e => setLoginForm({...loginForm, email: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-400 uppercase ml-2">Passkey</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                      <input 
                        type="password" required placeholder="••••••••" 
                        className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-indigo-50 rounded-2xl outline-none focus:border-indigo-600 transition-all font-bold"
                        value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                      />
                    </div>
                  </div>
                  <button 
                    type="submit" 
                    disabled={loginLoading}
                    className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all uppercase tracking-widest text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loginLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Access Portal'}
                  </button>

                  {view === 'adminLogin' && (
                    <div className="space-y-4 pt-2">
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                        <div className="relative flex justify-center text-[10px] uppercase font-black"><span className="px-2 bg-white text-gray-400">Or Login Via</span></div>
                      </div>
                      <button 
                        type="button"
                        onClick={handleGoogleLogin}
                        className="w-full flex items-center justify-center gap-3 py-3.5 bg-white border-2 border-indigo-50 rounded-2xl font-bold text-gray-700 hover:bg-indigo-50 transition-all shadow-sm"
                      >
                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" referrerPolicy="no-referrer" />
                        Continue with Google
                      </button>
                    </div>
                  )}

                  {view === 'teacherLogin' && (
                    <p className="text-center text-xs text-gray-500 mt-4">
                      New user? <button type="button" onClick={() => setView('teacherSignUp' as any)} className="text-indigo-600 font-bold hover:underline">Sign in</button>
                    </p>
                  )}
                </form>
              </Card>
            </motion.div>
          )}

          {view === 'teacherSignUp' && (
            <motion.div key="signup" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
              <button onClick={() => setView('teacherLogin' as any)} className="mb-6 text-indigo-400 font-bold flex items-center gap-2 uppercase text-[10px] tracking-widest"><ChevronLeft className="w-3 h-3"/> Back to Login</button>
              <Card title="Teacher Registration">
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const data = new FormData(form);
                  const name = data.get('name') as string;
                  const mobile = data.get('mobile') as string;
                  const email = data.get('email') as string;
                  const password = data.get('password') as string;
                  
                  // Get multi-select values
                  const selectedClasses = FLattenClasses.filter((_, i) => (document.getElementById(`class-${i}`) as HTMLInputElement)?.checked);
                  const selectedSubjects = schoolSettings.subjects.filter((_, i) => (document.getElementById(`sub-${i}`) as HTMLInputElement)?.checked);

                  if (selectedClasses.length === 0 || selectedSubjects.length === 0) {
                    alert("Please select classes and subjects.");
                    return;
                  }

                  try {
                    const { createUserWithEmailAndPassword } = await import('firebase/auth');
                    const res = await createUserWithEmailAndPassword(auth, email, password);
                    const profile: Teacher = {
                      uid: res.user.uid,
                      name,
                      mobile,
                      email,
                      classes: selectedClasses,
                      subjects: selectedSubjects,
                      role: 'teacher'
                    };
                    await setDoc(doc(db, 'users', res.user.uid), profile);
                    setUserProfile(profile);
                    setView('teacherPortal');
                  } catch (err: any) {
                    alert("Registration Error: " + err.message);
                  }
                }} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-indigo-400 uppercase ml-2">Full Name</label>
                       <input name="name" type="text" required placeholder="John Doe" className="w-full px-4 py-3 bg-gray-50 border border-indigo-50 rounded-2xl outline-none focus:border-indigo-600 transition-all font-bold" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-indigo-400 uppercase ml-2">Mobile Number</label>
                       <input name="mobile" type="tel" required placeholder="9876543210" className="w-full px-4 py-3 bg-gray-50 border border-indigo-50 rounded-2xl outline-none focus:border-indigo-600 transition-all font-bold" />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-indigo-400 uppercase ml-2">Official Email</label>
                       <input name="email" type="email" required placeholder="name@ssm.portal" className="w-full px-4 py-3 bg-gray-50 border border-indigo-50 rounded-2xl outline-none focus:border-indigo-600 transition-all font-bold" />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-indigo-400 uppercase ml-2">Create Password</label>
                       <input name="password" type="password" required placeholder="••••••••" className="w-full px-4 py-3 bg-gray-50 border border-indigo-50 rounded-2xl outline-none focus:border-indigo-600 transition-all font-bold" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Select Assigned Classes (6 - 12)</label>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                       {FLattenClasses.map((cls, i) => (
                         <label key={cls} className="flex items-center gap-2 p-2 bg-gray-50 rounded-xl cursor-pointer hover:bg-indigo-50 transition-all">
                           <input type="checkbox" id={`class-${i}`} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600" />
                           <span className="text-[10px] font-bold text-gray-700">{cls}</span>
                         </label>
                       ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Select Teaching Subjects</label>
                    <div className="flex flex-wrap gap-2">
                       {schoolSettings.subjects.map((sub, i) => (
                         <label key={sub} className="flex items-center gap-2 p-2 px-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-indigo-50 transition-all">
                           <input type="checkbox" id={`sub-${i}`} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600" />
                           <span className="text-xs font-bold text-gray-700">{sub}</span>
                         </label>
                       ))}
                       {schoolSettings.subjects.length === 0 && <p className="text-[10px] text-gray-400">Loading subjects from system...</p>}
                    </div>
                  </div>

                  <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all uppercase tracking-widest text-sm">
                    Complete Registration
                  </button>
                </form>
              </Card>
            </motion.div>
          )}

          {view === 'adminPortal' && userProfile?.role === 'admin' && (
            <motion.div key="admin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
              {/* Sidebar/Navigation Replacement */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { id: 'dashboard', icon: LayoutDashboard, label: 'DASHBOARD' },
                  { id: 'attendance', icon: CalendarCheck, label: 'ATTENDANCE' },
                  { id: 'arrangement', icon: Sparkles, label: 'ARRANGEMENT' },
                  { id: 'teachers', icon: Users, label: 'TEACHERS' },
                  { id: 'students', icon: UserCheck, label: 'STUDENTS' },
                  { id: 'timetable', icon: Clock, label: 'TIMETABLE' }
                ].map(item => (
                  <button 
                    key={item.id}
                    onClick={() => setActiveAdminSection(item.id as any)}
                    className={`py-4 rounded-3xl font-black text-[10px] tracking-widest flex flex-col items-center gap-2 transition-all border-2 ${activeAdminSection === item.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-xl shadow-indigo-600/30 -translate-y-1' : 'bg-white text-indigo-600 border-indigo-50 hover:bg-indigo-50'}`}
                  >
                    <item.icon className="w-5 h-5" /> {item.label}
                  </button>
                ))}
              </div>

              {activeAdminSection === 'dashboard' && (
                <div className="space-y-10">
                  <div className="grid md:grid-cols-3 gap-6">
                    <div className="bg-white p-8 rounded-[2rem] border border-indigo-50 shadow-sm flex items-center gap-6">
                      <div className="w-16 h-16 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center">
                        <Users className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase">Active Teachers</p>
                        <h4 className="text-3xl font-black text-indigo-950">{allTeachers.length}</h4>
                      </div>
                    </div>
                    <div className="bg-white p-8 rounded-[2rem] border border-indigo-50 shadow-sm flex items-center gap-6">
                      <div className="w-16 h-16 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center text-orange-600">
                        <FileText className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase">Pending Leaves</p>
                        <h4 className="text-3xl font-black text-indigo-950">{leaves.filter(l => l.status === 'pending').length}</h4>
                      </div>
                    </div>
                    <div className="bg-white p-8 rounded-[2rem] border border-indigo-50 shadow-sm flex items-center gap-6">
                      <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-indigo-600">
                        <CalendarCheck className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase">Attendance Today</p>
                        <h4 className="text-3xl font-black text-indigo-950">{attendance.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).length}</h4>
                      </div>
                    </div>
                  </div>

                  <div className="grid lg:grid-cols-2 gap-10">
                    <Card title="Quick Master Control" icon={ShieldCheck}>
                      <div className="grid grid-cols-2 gap-4">
                        <button 
                          onClick={exportMasterAttendance}
                          className="p-6 bg-indigo-50 rounded-3xl border-2 border-indigo-100 flex flex-col items-center gap-3 hover:bg-indigo-600 hover:text-white transition-all group"
                        >
                          <Download className="w-10 h-10 text-indigo-600 group-hover:text-white" />
                          <span className="font-bold text-xs">EXPORT ATTENDANCE</span>
                        </button>
                        <button 
                          onClick={markTodayAsHoliday}
                          className="p-6 bg-orange-50 rounded-3xl border-2 border-orange-100 flex flex-col items-center gap-3 hover:bg-orange-600 hover:text-white transition-all group"
                        >
                          <Calendar className="w-10 h-10 text-orange-600 group-hover:text-white" />
                          <span className="font-bold text-xs">MARK TODAY HOLIDAY</span>
                        </button>
                      </div>
                    </Card>

                    <Card title="Recent Leave Actions" icon={FileText}>
                      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {leaves.filter(l => l.status === 'pending').length === 0 && <p className="text-center py-10 text-gray-400 italic">No pending requests.</p>}
                        {leaves.filter(l => l.status === 'pending').map(l => (
                          <div key={l.id} className="p-4 bg-gray-50 rounded-2xl border flex justify-between items-center group">
                            <div>
                              <p className="font-black text-indigo-950">{l.teacherName}</p>
                              <p className="text-[10px] text-gray-500">{l.startDate} to {l.endDate}</p>
                            </div>
                            <button onClick={() => setActiveAdminSection('arrangement')} className="p-2 bg-indigo-100 text-indigo-600 rounded-lg group-hover:bg-indigo-600 group-hover:text-white transition-all"><ArrowUpRight className="w-4 h-4"/></button>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {activeAdminSection === 'attendance' && (
                <div className="space-y-8">
                  <Card title="Master Attendance Archive" icon={CalendarCheck} headerAction={
                    <div className="flex items-center gap-4 bg-white/10 p-1 rounded-xl">
                       <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 hover:bg-white/20 rounded text-white"><ChevronLeft className="w-4 h-4"/></button>
                       <span className="text-xs font-black text-white min-w-[100px] text-center">{format(currentMonth, 'MMM yyyy').toUpperCase()}</span>
                       <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 hover:bg-white/20 rounded text-white"><ChevronRight className="w-4 h-4"/></button>
                    </div>
                  }>
                    <div className="space-y-6">
                      <div className="flex justify-between items-center">
                        <div className="flex gap-4">
                           {['P', 'A', 'L', 'H'].map(type => (
                             <div key={type} className="flex items-center gap-1.5">
                               <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black ${type === 'P' ? 'bg-green-50 text-green-600' : type === 'A' ? 'bg-red-50 text-red-600' : type === 'L' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>{type}</span>
                               <span className="text-[10px] font-bold text-gray-400 uppercase">{type === 'P' ? 'Present' : type === 'A' ? 'Absent' : type === 'L' ? 'Leave' : 'Holiday'}</span>
                             </div>
                           ))}
                        </div>
                        <button onClick={exportMasterAttendance} className="bg-indigo-600 text-white px-6 py-2 rounded-2xl font-black text-xs hover:bg-indigo-700 shadow-md">DOWNLOAD EXCEL REPORT</button>
                      </div>
                      <AttendanceGrid month={currentMonth} teachers={allTeachers} attendance={attendance} leaves={leaves} holidays={holidays} />
                    </div>
                  </Card>
                </div>
              )}

              {activeAdminSection === 'arrangement' && (
                <div className="space-y-6">
                  <div className="bg-white p-2 rounded-[2rem] border border-indigo-50 shadow-sm inline-flex gap-2">
                    {[
                      { id: 'view', label: 'PREVIOUS', icon: History },
                      { id: 'generate', label: 'GENERATE/VIEW TODAY', icon: Sparkles },
                      { id: 'leaves', label: 'LEAVE REQUESTS', icon: Mail }
                    ].map(tab => (
                      <button 
                        key={tab.id}
                        onClick={() => setActiveArrangementTab(tab.id as any)}
                        className={`px-8 py-3 rounded-[1.5rem] font-black text-xs transition-all ${activeArrangementTab === tab.id ? 'bg-indigo-600 text-white shadow-xl' : 'text-indigo-400 hover:bg-gray-50'}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {activeArrangementTab === 'view' && (
                    <Card title="Previous Arrangements" icon={History} 
                      headerAction={
                        <div className="flex items-center gap-4 bg-white/10 px-4 py-1 rounded-xl">
                           <button onClick={() => setArrangementDate(prev => subDays(prev, 1))} className="text-white hover:text-indigo-300"><ChevronLeft className="w-5 h-5"/></button>
                           <span className="text-xs font-black text-white min-w-[120px] text-center">{format(arrangementDate, 'dd MMM yyyy')}</span>
                           <button onClick={() => setArrangementDate(prev => addDays(prev, 1))} className="text-white hover:text-indigo-300"><ChevronRight className="w-5 h-5"/></button>
                        </div>
                      }
                    >
                       <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {arrangements.find(a => a.date === format(arrangementDate, 'yyyy-MM-dd'))?.substitutions.reduce((acc: any[], sub) => {
                             let existing = acc.find(x => x.absentTeacherId === sub.absentTeacherId);
                             if (existing) {
                               existing.subs.push(sub);
                             } else {
                               acc.push({ absentTeacherId: sub.absentTeacherId, absentTeacherName: sub.absentTeacherName, subs: [sub] });
                             }
                             return acc;
                          }, []).map((at, idx) => (
                             <div key={idx} className="bg-white border-2 border-indigo-50 rounded-3xl p-6 shadow-sm border-t-8 border-red-500">
                                <h5 className="font-black text-indigo-950 mb-4 border-b pb-2 text-center text-lg">{at.absentTeacherName}</h5>
                                <table className="w-full text-[10px]">
                                   <thead>
                                     <tr className="text-indigo-400 uppercase font-black border-b border-indigo-50">
                                       <th className="text-left py-2">PERIOD</th>
                                       <th className="text-left py-2">CLASS</th>
                                       <th className="text-left py-2">SUBSTITUTE</th>
                                     </tr>
                                   </thead>
                                   <tbody>
                                      {at.subs.sort((a,b) => a.period - b.period).map((s, i) => (
                                        <tr key={i} className="border-b last:border-0 border-indigo-50/50">
                                           <td className="py-3 font-black text-indigo-600">Bell {s.period}</td>
                                           <td className="py-3 font-bold">{s.class}</td>
                                           <td className="py-3 font-black text-gray-700 bg-indigo-50/50 px-3 rounded-lg">{s.substituteName}</td>
                                        </tr>
                                      ))}
                                   </tbody>
                                </table>
                             </div>
                          ))}
                          {(!arrangements.find(a => a.date === format(arrangementDate, 'yyyy-MM-dd'))) && (
                             <div className="text-center py-20 col-span-full italic text-gray-400">No arrangement data for this date.</div>
                          )}
                       </div>
                    </Card>
                  )}

                  {activeArrangementTab === 'generate' && (
                    <Card title="Substitution Manager" icon={Sparkles}>
                       <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-6">
                          <div>
                             <h4 className="text-2xl font-black text-indigo-950">Daily Arrangement Status</h4>
                             <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
                          </div>
                          {!arrangements.some(a => a.date === format(new Date(), 'yyyy-MM-dd')) ? (
                            <button 
                              onClick={async () => {
                                const todayDate = format(new Date(), 'yyyy-MM-dd');
                                const dayName = format(new Date(), 'EEEE');
                                const absentIds = leaves.filter(l => l.status === 'approved' && todayDate >= l.startDate && todayDate <= l.endDate).map(l => l.teacherId);
                                
                                if (absentIds.length === 0) return alert("All staff members are present (No approved leaves today).");

                                const newSubs: any[] = [];
                                absentIds.forEach(absId => {
                                  const tt = timetable.filter(e => e.teacherId === absId && e.day === dayName);
                                  const absentName = allTeachers.find(t => t.uid === absId)?.name || 'Unknown';
                                  
                                  tt.forEach(period => {
                                    const freeTeachers = allTeachers.filter(t => 
                                      !absentIds.includes(t.uid) && 
                                      !timetable.some(e => e.teacherId === t.uid && e.day === dayName && e.bell === period.bell)
                                    );
                                    
                                    const sub = freeTeachers[Math.floor(Math.random() * freeTeachers.length)];
                                    newSubs.push({
                                      absentTeacherId: absId,
                                      absentTeacherName: absentName,
                                      period: period.bell,
                                      class: `${period.class}${period.section}`,
                                      subject: period.subject,
                                      substituteId: sub?.uid || 'UNASSIGNED',
                                      substituteName: sub?.name || 'FREE PERIOD'
                                    });
                                  });
                                });

                                await setDoc(doc(db, 'arrangements', todayDate), {
                                  date: todayDate,
                                  substitutions: newSubs,
                                  createdAt: new Date().toISOString()
                                });
                                alert("Success: Substitution table generated!");
                              }}
                              className="bg-indigo-600 text-white px-12 py-5 rounded-3xl font-black text-sm hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-600/20 active:scale-95"
                            >
                              GENERATE TODAY'S ARRANGEMENT
                            </button>
                          ) : (
                            <div className="flex items-center gap-4 bg-green-50 text-green-600 px-8 py-3 rounded-2xl border-2 border-green-200">
                               <CheckCircle2 className="w-6 h-6" />
                               <span className="font-black text-sm uppercase">Arrangement Live</span>
                            </div>
                          )}
                       </div>
                       
                       <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {arrangements.find(a => a.date === format(new Date(), 'yyyy-MM-dd'))?.substitutions.reduce((acc: any[], sub) => {
                           let existing = acc.find(x => x.absentTeacherId === sub.absentTeacherId);
                           if (existing) {
                             existing.subs.push(sub);
                           } else {
                             acc.push({ absentTeacherId: sub.absentTeacherId, absentTeacherName: sub.absentTeacherName, subs: [sub] });
                           }
                           return acc;
                        }, []).map((at, idx) => (
                           <div key={idx} className="bg-white border-2 border-indigo-50 rounded-[2.5rem] p-8 shadow-sm transition-all hover:shadow-xl hover:border-indigo-200 border-t-[12px] border-t-indigo-600">
                             <h5 className="font-black text-indigo-950 mb-6 text-center text-xl">{at.absentTeacherName}</h5>
                             <div className="space-y-4">
                                {at.subs.sort((a,b) => a.period - b.period).map((s, i) => (
                                  <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-indigo-50">
                                     <div>
                                        <p className="text-[10px] font-black text-indigo-400 uppercase leading-none mb-1">Bell {s.period}</p>
                                        <p className="font-black text-indigo-900">{s.class}</p>
                                     </div>
                                     <div className="text-right">
                                        <p className="text-[9px] font-black text-gray-400 uppercase leading-none mb-1">Substitute</p>
                                        <p className="font-bold text-gray-700">{s.substituteName}</p>
                                     </div>
                                  </div>
                                ))}
                             </div>
                           </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {activeArrangementTab === 'leaves' && (
                    <div className="space-y-10">
                      <Card title="Active Leave Applications" icon={Mail}
                        headerAction={
                          <div className="flex bg-indigo-50 rounded-xl p-1">
                             <button onClick={() => setShowAllLeaves(false)} className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${!showAllLeaves ? 'bg-indigo-600 text-white shadow-lg' : 'text-indigo-400'}`}>Pending</button>
                             <button onClick={() => setShowAllLeaves(true)} className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${showAllLeaves ? 'bg-indigo-600 text-white shadow-lg' : 'text-indigo-400'}`}>All History</button>
                          </div>
                        }
                      >
                         <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {leaves.filter(l => showAllLeaves ? true : l.status === 'pending').sort((a,b) => b.startDate.localeCompare(a.startDate)).map(l => (
                            <div key={l.id} className="bg-white p-8 rounded-[2rem] border-2 border-indigo-50 hover:border-indigo-600 transition-all group">
                               <div className="flex justify-between items-start mb-6">
                                  <div>
                                     <h5 className="text-2xl font-black text-indigo-950 leading-tight">{l.teacherName}</h5>
                                     <p className="text-xs font-bold text-indigo-400">{l.mobile}</p>
                                  </div>
                                  <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest border ${
                                    l.status === 'approved' ? 'bg-green-50 text-green-600 border-green-100' : 
                                    l.status === 'rejected' ? 'bg-red-50 text-red-600 border-red-100' : 
                                    'bg-orange-50 text-orange-600 border-orange-100'
                                  }`}>{l.status === 'pending' ? 'Review' : l.status}</span>
                               </div>
                               <div className="bg-gray-50 p-5 rounded-2xl mb-6 relative overflow-hidden group-hover:bg-indigo-50 transition-colors">
                                  <div className={`absolute top-0 left-0 w-1 h-full ${l.status === 'approved' ? 'bg-green-400' : l.status === 'rejected' ? 'bg-red-400' : 'bg-indigo-200'}`}></div>
                                  <p className="text-xs font-bold text-indigo-950 mb-2 flex items-center gap-2 font-mono"><Calendar className="w-4 h-4 text-indigo-400"/> {l.startDate} » {l.endDate}</p>
                                  <p className="text-sm italic text-gray-600 font-medium">"{l.reason}"</p>
                               </div>
                               {l.status === 'pending' && (
                                 <div className="flex gap-4">
                                    <button onClick={async () => { if(confirm("Approve this leave?")) await updateDoc(doc(db, 'leaves', l.id), { status: 'approved' }); }} className="flex-1 bg-green-500 text-white font-black py-4 rounded-xl text-xs hover:bg-green-600 shadow-lg shadow-green-100 uppercase transition-all">Approve</button>
                                    <button onClick={async () => { if(confirm("Reject this leave?")) await updateDoc(doc(db, 'leaves', l.id), { status: 'rejected' }); }} className="flex-1 bg-red-100 text-red-500 font-black py-4 rounded-xl text-xs hover:bg-red-500 hover:text-white uppercase transition-all">Reject</button>
                                 </div>
                               )}
                               {l.status !== 'pending' && (
                                 <button onClick={async () => { if(confirm("Move back to pending for re-evaluation?")) await updateDoc(doc(db, 'leaves', l.id), { status: 'pending' }); }} className="w-full py-4 border-2 border-dashed border-gray-100 rounded-xl text-[10px] font-black text-gray-400 uppercase tracking-widest hover:border-indigo-200 hover:text-indigo-400 transition-all">Reset Status</button>
                               )}
                            </div>
                          ))}
                          {leaves.filter(l => showAllLeaves ? true : l.status === 'pending').length === 0 && (
                            <div className="col-span-full py-24 text-center">
                               <Mail className="w-16 h-16 text-indigo-100 mx-auto mb-4" />
                               <p className="text-gray-400 italic font-bold">No leave requests found in this category.</p>
                            </div>
                          )}
                        </div>
                      </Card>
                    </div>
                  )}
                </div>
              )}

              {activeAdminSection === 'teachers' && (
                <div className="space-y-6">
                  <Card title="Institutional Faculty List" icon={Users} 
                    headerAction={
                      <button 
                        onClick={() => {
                          const sheetData = allTeachers.map(t => {
                            const monthAtt = attendance.filter(a => a.teacherId === t.uid && isSameMonth(parseISO(a.date), new Date())).length;
                            const totalAtt = attendance.filter(a => a.teacherId === t.uid).length;
                            return {
                              'Teacher Name': t.name,
                              'Mobile': t.mobile,
                              'Email/ID': t.email,
                              'Password': t.password || 'PORTAL_LOGIN',
                              'Monthly Attendance': `${monthAtt}/25`,
                              'Session Attendance': `${totalAtt}/200`
                            };
                          });
                          const ws = XLSX.utils.json_to_sheet(sheetData);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, "Faculty");
                          XLSX.writeFile(wb, "SSM_Teacher_List.xlsx");
                        }}
                        className="bg-white/10 text-white px-6 py-2 rounded-xl font-black text-[10px] tracking-widest flex items-center gap-2 hover:bg-white/20"
                      >
                        <Download className="w-4 h-4"/> EXPORT EXCEL
                      </button>
                    }
                  >
                    <div className="overflow-x-auto">
                       <table className="w-full">
                          <thead>
                            <tr className="text-left text-[10px] font-black text-indigo-400 uppercase tracking-widest border-b-2 border-indigo-50">
                              <th className="px-6 py-4">Name/ID</th>
                              <th className="px-6 py-4">Password</th>
                              <th className="px-6 py-4">Month Attendance</th>
                              <th className="px-6 py-4">Session Attendance</th>
                              <th className="px-6 py-4 text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-indigo-50">
                            {allTeachers.map(t => {
                              const monthAtt = attendance.filter(a => a.teacherId === t.uid && isSameMonth(parseISO(a.date), new Date())).length;
                              const totalAtt = attendance.filter(a => a.teacherId === t.uid).length;
                              return (
                                <tr key={t.uid} className="hover:bg-indigo-50/30 transition-all">
                                  <td className="px-6 py-4">
                                     <p className="font-black text-indigo-950">{t.name}</p>
                                     <p className="text-[10px] text-gray-400 font-mono">{t.email}</p>
                                  </td>
                                  <td className="px-6 py-4 font-mono text-[10px] text-indigo-400 font-black">{t.password || 'SSM_PORTAL'}</td>
                                  <td className="px-6 py-4">
                                     <span className="font-black text-indigo-600">{monthAtt}</span> <span className="text-[10px] text-gray-400">/ 25</span>
                                  </td>
                                  <td className="px-6 py-4">
                                     <span className="font-black text-indigo-600">{totalAtt}</span> <span className="text-[10px] text-gray-400">/ 200</span>
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                     <button onClick={async () => { if(confirm(`Delete ${t.name}?`)) await deleteDoc(doc(db, 'users', t.uid)); }} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                       </table>
                    </div>
                  </Card>
                </div>
              )}

              {activeAdminSection === 'students' && (
                <div className="space-y-6">
                  <Card title="Student Strength & Presence Records" icon={UserCheck}
                    headerAction={
                      <button 
                        onClick={() => {
                          const sheetData = studentAttendance.map(sa => ({
                            Date: sa.date,
                            Class: sa.class,
                            'Total Strength': sa.totalStudents,
                            'Present Today': sa.present,
                            'Absent Today': sa.absent,
                            'Uploaded By': sa.recordedByName
                          }));
                          const ws = XLSX.utils.json_to_sheet(sheetData);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, "Students");
                          XLSX.writeFile(wb, "Student_Attendance_Archive.xlsx");
                        }}
                        className="bg-white/10 text-white px-6 py-2 rounded-xl font-black text-[10px] tracking-widest flex items-center gap-2 hover:bg-white/20"
                      >
                        <Download className="w-4 h-4"/> DOWNLOAD ALL CLASS DETAILS
                      </button>
                    }
                  >
                     <div className="overflow-x-auto">
                        <table className="w-full">
                           <thead>
                              <tr className="text-left text-[10px] font-black text-indigo-400 uppercase tracking-widest border-b-2 border-indigo-50">
                                 <th className="px-6 py-4">Date</th>
                                 <th className="px-6 py-4">Class</th>
                                 <th className="px-6 py-4">Strength</th>
                                 <th className="px-6 py-4">Present / Absent</th>
                                 <th className="px-6 py-4">Class Teacher</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-indigo-50">
                              {studentAttendance.sort((a,b) => b.date.localeCompare(a.date)).map(sa => (
                                <tr key={sa.id} className="hover:bg-indigo-50/20">
                                   <td className="px-6 py-4 text-xs font-bold text-gray-500">{format(parseISO(sa.date), 'dd MMM yyyy')}</td>
                                   <td className="px-6 py-4 font-black text-indigo-900">{sa.class}</td>
                                   <td className="px-6 py-4 text-xs font-bold">{sa.totalStudents}</td>
                                   <td className="px-6 py-4">
                                      <div className="flex gap-2 font-black">
                                         <span className="text-green-600">{sa.present} P</span>
                                         <span className="text-red-500">{sa.absent} A</span>
                                      </div>
                                   </td>
                                   <td className="px-6 py-4 text-[10px] font-black text-indigo-400">{sa.recordedByName}</td>
                                </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                  </Card>
                </div>
              )}

              {activeAdminSection === 'timetable' && <TimetableSection />}
            </motion.div>
          )}

          {view === 'teacherPortal' && userProfile?.role === 'teacher' && (
            <motion.div key="teacher" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10 pb-20">
               {/* Arrangement Notification */}
               {arrangements.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).flatMap(a => a.substitutions).filter(s => s.substituteId === user.uid).length > 0 && (
                 <div className="bg-gradient-to-r from-red-600 via-orange-600 to-red-600 p-10 rounded-[3rem] text-white shadow-2xl shadow-red-200 relative overflow-hidden border-4 border-white">
                   <div className="relative z-10">
                     <div className="flex items-center gap-6 mb-6">
                       <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-xl">
                          <AlertCircle className="w-10 h-10 text-white animate-bounce" />
                       </div>
                       <div>
                          <h3 className="text-4xl font-black italic tracking-tighter uppercase leading-none">Emergency Arrangement</h3>
                          <p className="text-lg font-bold opacity-80 mt-2">Substitution assigned for your free periods today</p>
                       </div>
                     </div>
                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {arrangements.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).flatMap(a => a.substitutions).filter(s => s.substituteId === user.uid).map((s, idx) => (
                           <div key={idx} className="bg-black/20 backdrop-blur-xl p-6 rounded-[2rem] border border-white/20 hover:bg-black/30 transition-all">
                             <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Bell {s.period}</span>
                                <Sparkles className="w-4 h-4 text-orange-300" />
                             </div>
                             <p className="text-3xl font-black uppercase leading-tight italic">{s.class}</p>
                             <p className="text-xs font-bold opacity-70 mt-1 uppercase tracking-widest">{s.subject}</p>
                           </div>
                        ))}
                     </div>
                   </div>
                   <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
                 </div>
               )}

                {/* Student Attendance Marker (Class Teacher Logic: Teacher with Bell 1) */}
                {(() => {
                   const todayName = format(new Date(), 'EEEE');
                   // Find the class where this teacher has Bell 1. 
                   // If today is Sunday or holiday, we check for Monday as a reference for "Class Teacher" role
                   const refDay = (todayName === 'Sunday' || holidays.some(h => h.date === format(new Date(), 'yyyy-MM-dd'))) ? 'Monday' : todayName;
                   const classTeacherEntry = timetable.find(tt => tt.teacherId === auth.currentUser?.uid && tt.day === refDay && tt.bell === 1);
                   if (!classTeacherEntry) return null;
                   
                   const cls = `${classTeacherEntry.class}${classTeacherEntry.section}`;
                   const alreadyMarked = studentAttendance.some(sa => sa.class === cls && sa.date === format(new Date(), 'yyyy-MM-dd'));
                   
                   return (
                     <div className="space-y-10 mb-10">
                        <Card 
                          title={`Administrative: Class Attendance (${cls})`} 
                          icon={UserCheck}
                          className="bg-indigo-900 border-none shadow-2xl shadow-indigo-900/40"
                        >
                           {!alreadyMarked ? (
                             <form onSubmit={async (e) => {
                               e.preventDefault();
                               const form = e.target as HTMLFormElement;
                               const strength = parseInt((form.elements.namedItem('strength') as HTMLInputElement).value);
                               const present = parseInt((form.elements.namedItem('present') as HTMLInputElement).value);
                               const absent = strength - present;

                               if (present > strength) {
                                 alert("Present students cannot exceed total strength!");
                                 return;
                               }

                               await addDoc(collection(db, 'studentAttendance'), {
                                 date: format(new Date(), 'yyyy-MM-dd'),
                                 class: cls,
                                 totalStudents: strength,
                                 present,
                                 absent,
                                 recordedBy: auth.currentUser?.uid,
                                 recordedByName: userProfile?.name
                               });
                               alert("Attendance for Class " + cls + " recorded!");
                             }} className="grid md:grid-cols-3 gap-6 items-end text-white">
                                <div className="space-y-2">
                                   <label className="text-[10px] font-black text-indigo-300 uppercase ml-2 tracking-widest">Enrollment</label>
                                   <input name="strength" type="number" required placeholder="Total Strength" className="w-full px-6 py-4 bg-white/10 border border-white/20 rounded-2xl outline-none focus:border-white text-white font-black text-xl" />
                                </div>
                                <div className="space-y-2">
                                   <label className="text-[10px] font-black text-indigo-300 uppercase ml-2 tracking-widest">Count Present</label>
                                   <input name="present" type="number" required placeholder="Present Count" className="w-full px-6 py-4 bg-white/10 border border-white/20 rounded-2xl outline-none focus:border-white text-white font-black text-xl" />
                                </div>
                                <button type="submit" className="bg-white text-indigo-600 font-black py-4 rounded-2xl shadow-2xl hover:bg-gray-100 transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2">
                                  <Save className="w-4 h-4" /> UPLOAD ATTENDANCE
                                </button>
                             </form>
                           ) : (
                             <div className="flex items-center gap-6 text-white py-4 bg-white/5 rounded-[2rem] px-8">
                                <div className="w-16 h-16 bg-green-500 rounded-2xl flex items-center justify-center shadow-lg shadow-green-500/20">
                                   <CheckCircle2 className="w-8 h-8 text-white" />
                                </div>
                                <div>
                                   <p className="text-2xl font-black italic tracking-tighter">Class Attendance Complete</p>
                                   <p className="text-xs font-bold opacity-60 uppercase tracking-widest">Records for Class {cls} updated for today</p>
                                </div>
                             </div>
                           )}
                        </Card>

                        <Card title={`Class Time Table - ${cls}`} icon={GraduationCap} className="w-full">
                           <div className="overflow-x-auto">
                              <div className="flex gap-4 min-w-max pb-4">
                                 {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => {
                                    const dayEntries = timetable.filter(t => `${t.class}${t.section}` === cls && t.day === day).sort((a,b) => a.bell - b.bell);
                                    return (
                                       <div key={day} className="w-64 bg-gray-50 p-6 rounded-[2rem] border border-gray-100">
                                          <p className="text-[10px] font-black text-indigo-600 uppercase mb-4 text-center border-b border-indigo-100 pb-2 tracking-widest">{day}</p>
                                          <div className="space-y-3">
                                             {[1,2,3,4,5,6,7,8].map(bell => {
                                                const entry = dayEntries.find(e => e.bell === bell);
                                                return (
                                                   <div key={bell} className={`p-3 rounded-2xl text-[10px] border transition-all ${entry ? 'bg-white border-indigo-50 shadow-sm' : 'bg-gray-100/50 border-dashed border-gray-200 opacity-40'}`}>
                                                      <div className="flex justify-between items-center mb-1">
                                                         <span className="font-black text-gray-400 uppercase">Bell {bell}</span>
                                                         {entry && <span className="p-1 px-2 bg-indigo-50 text-indigo-600 rounded-lg font-black text-[8px] uppercase">{entry.subject}</span>}
                                                      </div>
                                                      {entry && <p className="font-bold text-indigo-900 border-t border-indigo-50 mt-1 pt-1 italic">{allTeachers.find(t => t.uid === entry.teacherId)?.name || 'N/A'}</p>}
                                                      {!entry && <p className="text-center font-bold text-gray-300 italic">Empty</p>}
                                                   </div>
                                                );
                                             })}
                                          </div>
                                       </div>
                                    );
                                 })}
                              </div>
                           </div>
                        </Card>
                     </div>
                   );
                })()}

               {/* Teacher Dashboard View */}
               <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                  <Card title="Attendance Panel" icon={CalendarCheck}>
                     <div className="space-y-6">
                       <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                          <p className="text-[10px] font-black text-indigo-400 uppercase mb-3">Mark Attendance</p>
                          {!attendance.some(a => a.teacherId === user.uid && a.date === format(new Date(), 'yyyy-MM-dd')) ? (
                             <div className="space-y-3">
                               <input 
                                 id="att-code" type="text" placeholder="ENTER CODE" 
                                 className="w-full p-4 bg-white border border-indigo-50 rounded-2xl text-center text-xl font-black focus:border-indigo-600 outline-none transition-all uppercase"
                               />
                               <button 
                                 onClick={async () => {
                                   const code = (document.getElementById('att-code') as HTMLInputElement).value;
                                   if (code === attendanceCode) {
                                     await addDoc(collection(db, 'attendance'), {
                                       teacherId: user.uid,
                                       teacherName: userProfile.name,
                                       date: format(new Date(), 'yyyy-MM-dd'),
                                       timestamp: serverTimestamp()
                                     });
                                     alert("Present Marked!");
                                   } else {
                                     alert("Invalid Code!");
                                   }
                                 }}
                                 className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black text-xs shadow-lg shadow-indigo-100 uppercase"
                               >MARK PRESENT</button>
                             </div>
                          ) : (
                             <div className="bg-green-50 p-4 rounded-xl flex items-center gap-3">
                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                                <span className="text-xs font-black text-green-700">PRESENT TODAY</span>
                             </div>
                          )}
                       </div>

                       <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                          <p className="text-[10px] font-black text-indigo-400 uppercase mb-3">Previous Records</p>
                          <button 
                            onClick={exportTeacherAttendance}
                            className="w-full bg-white text-indigo-600 border border-indigo-200 py-3 rounded-xl font-black text-xs hover:bg-indigo-600 hover:text-white transition-all uppercase flex items-center justify-center gap-2"
                          >
                             <Download className="w-4 h-4" /> Export Attendance (Excel)
                          </button>
                          <p className="text-[9px] text-gray-400 font-bold mt-2 text-center uppercase">Current Session: {new Date().getFullYear()}-{ (new Date().getFullYear() + 1).toString().slice(-2) }</p>
                       </div>
                     </div>
                  </Card>

                  <Card title="Apply for Leave" icon={FileText}>
                    <div className="space-y-4">
                       <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-1">
                           <label className="text-[9px] font-black text-gray-400 uppercase ml-1">From</label>
                           <input type="date" id="l-start" className="w-full p-3 bg-gray-50 border rounded-xl text-xs outline-none focus:border-indigo-600 transition-all"/>
                         </div>
                         <div className="space-y-1">
                           <label className="text-[9px] font-black text-gray-400 uppercase ml-1">To</label>
                           <input type="date" id="l-end" className="w-full p-3 bg-gray-50 border rounded-xl text-xs outline-none focus:border-indigo-600 transition-all"/>
                         </div>
                       </div>
                       <div className="space-y-1">
                         <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Mobile No.</label>
                         <input type="tel" id="l-mobile" defaultValue={userProfile.mobile} className="w-full p-3 bg-gray-50 border rounded-xl text-xs outline-none focus:border-indigo-600 transition-all font-bold"/>
                       </div>
                       <textarea id="l-reason" placeholder="Reason for leave..." className="w-full p-4 bg-gray-50 border rounded-2xl text-xs h-24 outline-none focus:border-indigo-600 transition-all"></textarea>
                       <button 
                        onClick={async () => {
                          const start = (document.getElementById('l-start') as HTMLInputElement).value;
                          const end = (document.getElementById('l-end') as HTMLInputElement).value;
                          const mobile = (document.getElementById('l-mobile') as HTMLInputElement).value;
                          const reason = (document.getElementById('l-reason') as HTMLInputElement).value;
                          if (start && end && reason && mobile) {
                            await addDoc(collection(db, 'leaves'), {
                              teacherId: user.uid,
                              teacherName: userProfile.name,
                              mobile,
                              startDate: start,
                              endDate: end,
                              reason,
                              status: 'pending'
                            });
                            alert("Request Sent!");
                            (document.getElementById('l-reason') as HTMLTextAreaElement).value = '';
                          } else {
                            alert("Please fill all fields.");
                          }
                        }}
                        className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-xs hover:bg-indigo-700 transition-all uppercase tracking-widest shadow-xl shadow-indigo-100"
                       >SUBMIT APPLICATION</button>
                    </div>
                  </Card>

                  <Card title="My Time Table" icon={Clock}>
                     <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                       {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => {
                         const dayEntries = timetable.filter(t => t.teacherId === user.uid && t.day === day).sort((a,b) => a.bell - b.bell);
                         if (dayEntries.length === 0) return null;
                         return (
                           <div key={day} className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                              <h6 className="text-[10px] font-black text-indigo-600 uppercase mb-3 border-b border-indigo-100 pb-1">{day}</h6>
                              <div className="space-y-2">
                                 {dayEntries.map(entry => (
                                   <div key={entry.bell} className="bg-white p-2 rounded-xl text-[10px] flex justify-between items-center border border-indigo-50">
                                      <span className="font-black text-gray-400 uppercase">Bell {entry.bell}</span>
                                      <span className="font-bold text-indigo-700">Class {entry.class}{entry.section} • {entry.subject}</span>
                                   </div>
                                 ))}
                              </div>
                           </div>
                         );
                       })}
                       {timetable.filter(t => t.teacherId === user.uid).length === 0 && (
                         <div className="text-center py-10 opacity-40">
                            <Clock className="w-10 h-10 mx-auto mb-2" />
                            <p className="text-[10px] font-black uppercase">No schedule assigned yet</p>
                         </div>
                       )}
                     </div>
                  </Card>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </ErrorBoundary>
  );
}
