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
  deleteDoc,
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
  subDays,
  addDays,
  isSameDay,
  isPast,
  isToday,
  getDay
} from 'date-fns';
import { 
  generateTimetableAI, 
  suggestSubstitutionAI, 
  TimetableEntry, 
  SubjectRequirement 
} from './services/geminiService';

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
  password?: string; // Storing for admin view as requested
  createdAt?: any;
}

interface Arrangement {
  id?: string;
  date: string;
  absentTeachers: {
    teacherId: string;
    teacherName: string;
    substitutions: {
      bell: number;
      class: string;
      substituteId: string;
      substituteName: string;
    }[];
  }[];
}

interface StudentAttendance {
  id?: string;
  date: string;
  class: string;
  teacherId: string;
  teacherName: string;
  totalStudents: number;
  present: number;
  absent: number;
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
  const [studentAttForm, setStudentAttForm] = useState({ class: '', total: 0, present: 0, absent: 0 });

  const isClassTeacherOf = (cls: string) => {
    return fullTimetable.some(t => t.teacherId === user?.uid && t.class === cls && t.bell === 1);
  };

  const getMySubstitutionsToday = () => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayArr = arrangements.find(a => a.date === todayStr);
    if (!todayArr) return [];
    return todayArr.absentTeachers.flatMap(at => 
      at.substitutions.filter(s => s.substituteId === user?.uid).map(s => ({ ...s, absentTeacherName: at.teacherName }))
    );
  };
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [allTeachers, setAllTeachers] = useState<UserProfile[]>([]);
  const [allAttendance, setAllAttendance] = useState<AttendanceRecord[]>([]);
  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  const [fullTimetable, setFullTimetable] = useState<TimetableEntry[]>([]);
  const [subjectRequirements, setSubjectRequirements] = useState<SubjectRequirement[]>([]);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [substitutionSuggestions, setSubstitutionSuggestions] = useState<any[]>([]);
  const [loadingAI, setLoadingAI] = useState(false);
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [studentAttendance, setStudentAttendance] = useState<StudentAttendance[]>([]);
  const [arrangementDate, setArrangementDate] = useState(new Date());
  const [activeAdminSection, setActiveAdminSection] = useState<string | null>(null);
  const [activeArrangementSubSection, setActiveArrangementSubSection] = useState<'view' | 'generate' | 'leaves'>('generate');

  const handleFirestoreError = (error: any, operation: string, path: string) => {
    const errInfo = {
      error: error.message || String(error),
      operation,
      path,
      auth: {
        uid: user?.uid,
        email: user?.email,
      }
    };
    console.error(`Firestore Error [${operation}] on ${path}:`, JSON.stringify(errInfo));
  };
  
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
    }, (err) => handleFirestoreError(err, 'GET', 'settings/school'));

    return () => unsubSettings();
  }, []);

  // Listeners for Admin/Teacher data
  useEffect(() => {
    if (!user || !userProfile) return;

    let unsubLeaves: any;
    let unsubAttendance: any;
    let unsubCode: any;
    let unsubTeachers: any;
    let unsubTimetable: any;
    let unsubRequirements: any;
    let unsubArrangements: any;
    let unsubStudentAtt: any;

    if (userProfile.role === 'admin') {
      unsubLeaves = onSnapshot(collection(db, 'leaves'), (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
        // Auto-reject expired leaves
        const today = format(new Date(), 'yyyy-MM-dd');
        data.forEach(async (l) => {
          if (l.status === 'pending' && l.startDate < today) {
            await setDoc(doc(db, 'leaves', l.id), { ...l, status: 'rejected' });
          }
        });
        setLeaves(data);
        setAllLeaves(data);
      }, (err) => handleFirestoreError(err, 'LIST', 'leaves'));
      
      unsubAttendance = onSnapshot(collection(db, 'attendance'), (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
        setAttendance(data);
        setAllAttendance(data);
      }, (err) => handleFirestoreError(err, 'LIST', 'attendance'));

      unsubTeachers = onSnapshot(query(collection(db, 'users'), where('role', '==', 'teacher')), (snap) => {
        setAllTeachers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
      }, (err) => handleFirestoreError(err, 'LIST', 'users'));

      unsubTimetable = onSnapshot(doc(db, 'settings', 'timetable'), (snap) => {
        if (snap.exists()) setFullTimetable(snap.data().entries || []);
      }, (err) => handleFirestoreError(err, 'GET', 'settings/timetable'));

      unsubRequirements = onSnapshot(doc(db, 'settings', 'subjectRequirements'), (snap) => {
        if (snap.exists()) setSubjectRequirements(snap.data().requirements || []);
      }, (err) => handleFirestoreError(err, 'GET', 'settings/subjectRequirements'));

      unsubArrangements = onSnapshot(collection(db, 'arrangements'), (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Arrangement));
        // Cleanup: Only keep last 2 months
        const twoMonthsAgo = format(subMonths(new Date(), 2), 'yyyy-MM-dd');
        data.forEach(async (a) => {
          if (a.date < twoMonthsAgo && a.id) {
            await deleteDoc(doc(db, 'arrangements', a.id));
          }
        });
        setArrangements(data);
      }, (err) => handleFirestoreError(err, 'LIST', 'arrangements'));

      unsubStudentAtt = onSnapshot(collection(db, 'studentAttendance'), (snap) => {
        setStudentAttendance(snap.docs.map(d => ({ id: d.id, ...d.data() } as StudentAttendance)));
      }, (err) => handleFirestoreError(err, 'LIST', 'studentAttendance'));
    } else {
      const q = query(collection(db, 'leaves'), where('teacherId', '==', user.uid));
      unsubLeaves = onSnapshot(q, (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveRequest));
        setLeaves(data);
        setAllLeaves(data);
      }, (err) => handleFirestoreError(err, 'LIST', 'leaves'));

      const qAtt = query(collection(db, 'attendance'), where('teacherId', '==', user.uid));
      unsubAttendance = onSnapshot(qAtt, (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
        setAttendance(data);
        setAllAttendance(data);
      }, (err) => handleFirestoreError(err, 'LIST', 'attendance'));

      unsubTimetable = onSnapshot(doc(db, 'settings', 'timetable'), (snap) => {
        if (snap.exists()) setFullTimetable(snap.data().entries || []);
      }, (err) => handleFirestoreError(err, 'GET', 'settings/timetable'));

      unsubArrangements = onSnapshot(collection(db, 'arrangements'), (snap) => {
        setArrangements(snap.docs.map(d => ({ id: d.id, ...d.data() } as Arrangement)));
      }, (err) => handleFirestoreError(err, 'LIST', 'arrangements'));

      unsubStudentAtt = onSnapshot(collection(db, 'studentAttendance'), (snap) => {
        setStudentAttendance(snap.docs.map(d => ({ id: d.id, ...d.data() } as StudentAttendance)));
      }, (err) => handleFirestoreError(err, 'LIST', 'studentAttendance'));
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
    }, (err) => handleFirestoreError(err, 'LIST', 'attendanceCodes'));

    return () => {
      unsubLeaves?.();
      unsubAttendance?.();
      unsubCode?.();
      unsubTeachers?.();
      unsubTimetable?.();
      unsubRequirements?.();
      unsubArrangements?.();
      unsubStudentAtt?.();
    };
  }, [user, userProfile]);

  const handleGenerateTimetable = async () => {
    if (subjectRequirements.length === 0) {
      alert("Please set subject requirements first.");
      return;
    }
    setIsGeneratingAI(true);
    try {
      const teachersData = allTeachers.map(t => ({
        uid: t.uid,
        name: t.name,
        subjects: t.subjects || [],
        classes: t.classes || []
      }));
      const entries = await generateTimetableAI(teachersData, subjectRequirements);
      await setDoc(doc(db, 'settings', 'timetable'), { entries, updatedAt: serverTimestamp() });
      alert("AI Timetable generated successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to generate timetable.");
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleAISubstitution = async (leave: LeaveRequest) => {
    setLoadingAI(true);
    try {
      const absentTeacher = allTeachers.find(t => t.uid === leave.teacherId);
      if (!absentTeacher) return;

      const today = format(new Date(), 'EEEE'); // e.g., 'Monday'
      const todayTimetable = fullTimetable.filter(t => t.day === today);
      
      // Find teachers who are free at each bell the absent teacher was supposed to teach
      const freeTeachers = allTeachers.filter(t => t.uid !== leave.teacherId);
      
      const suggestions = await suggestSubstitutionAI(
        { name: absentTeacher.name, subjects: absentTeacher.subjects || [], classes: absentTeacher.classes || [] },
        freeTeachers.map(t => ({ name: t.name, subjects: t.subjects || [], classes: t.classes || [] })),
        todayTimetable
      );
      setSubstitutionSuggestions(suggestions);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAI(false);
    }
  };

  const updateRequirement = async (req: SubjectRequirement) => {
    const newReqs = [...subjectRequirements];
    const index = newReqs.findIndex(r => r.class === req.class && r.subject === req.subject);
    if (index > -1) newReqs[index] = req;
    else newReqs.push(req);
    await setDoc(doc(db, 'settings', 'subjectRequirements'), { requirements: newReqs });
  };

  const handleGenerateArrangement = async () => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const dayName = format(new Date(), 'EEEE');
    
    // 1. Find teachers on approved leave today
    const absentTeacherIds = allLeaves
      .filter(l => l.status === 'approved' && todayStr >= l.startDate && todayStr <= l.endDate)
      .map(l => l.teacherId);
    
    if (absentTeacherIds.length === 0) {
      alert("No teachers are on leave today.");
      return;
    }

    const absentTeachersData = allTeachers.filter(t => absentTeacherIds.includes(t.uid));
    const freeTeachers = allTeachers.filter(t => !absentTeacherIds.includes(t.uid));
    
    const newArrangement: Arrangement = {
      date: todayStr,
      absentTeachers: []
    };

    absentTeachersData.forEach(absentTeacher => {
      const teacherSchedule = fullTimetable.filter(t => t.teacherId === absentTeacher.uid && t.day === dayName);
      const substitutions: any[] = [];

      [1, 2, 3, 4, 5, 6, 7, 8].forEach(bell => {
        const entry = teacherSchedule.find(t => t.bell === bell);
        if (entry) {
          // Find a free teacher for this bell
          const substitute = freeTeachers.find(ft => {
            const ftSchedule = fullTimetable.filter(t => t.teacherId === ft.uid && t.day === dayName);
            return !ftSchedule.some(t => t.bell === bell);
          });

          if (substitute) {
            substitutions.push({
              bell,
              class: entry.class,
              substituteId: substitute.uid,
              substituteName: substitute.name
            });
          } else {
            substitutions.push({
              bell,
              class: entry.class,
              substituteId: 'N/A',
              substituteName: 'No Free Teacher'
            });
          }
        }
      });

      newArrangement.absentTeachers.push({
        teacherId: absentTeacher.uid,
        teacherName: absentTeacher.name,
        substitutions
      });
    });

    try {
      await addDoc(collection(db, 'arrangements'), newArrangement);
      alert("Arrangement generated successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to save arrangement.");
    }
  };

  const submitStudentAttendance = async (cls: string, total: number, present: number, absent: number) => {
    if (!user || !userProfile) return;
    try {
      await addDoc(collection(db, 'studentAttendance'), {
        date: format(new Date(), 'yyyy-MM-dd'),
        class: cls,
        teacherId: user.uid,
        teacherName: userProfile.name,
        totalStudents: total,
        present,
        absent,
        createdAt: serverTimestamp()
      });
      alert("Student attendance uploaded successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to upload student attendance.");
    }
  };

  const exportTeacherList = () => {
    const today = new Date();
    const monthStart = startOfMonth(today);
    const sessionStart = new Date(today.getFullYear(), 3, 1); // April 1st
    if (today < sessionStart) sessionStart.setFullYear(today.getFullYear() - 1);

    const workingDaysMonth = eachDayOfInterval({ start: monthStart, end: today }).filter(d => getDay(d) !== 0).length;
    const workingDaysSession = eachDayOfInterval({ start: sessionStart, end: today }).filter(d => getDay(d) !== 0).length;

    const data = allTeachers.map(t => {
      const attMonth = allAttendance.filter(a => a.teacherId === t.uid && a.date >= format(monthStart, 'yyyy-MM-dd')).length;
      const attSession = allAttendance.filter(a => a.teacherId === t.uid && a.date >= format(sessionStart, 'yyyy-MM-dd')).length;
      
      return {
        'Teacher Name': t.name,
        'Teacher ID': t.email.split('@')[0],
        'Password': t.password || 'N/A',
        'Mobile': t.mobile || 'N/A',
        'Classes': t.classes?.join(', ') || 'N/A',
        'Subjects': t.subjects?.join(', ') || 'N/A',
        'Month Attendance': `${attMonth}/${workingDaysMonth}`,
        'Session Attendance': `${attSession}/${workingDaysSession}`
      };
    });
    exportToExcel(data, 'Teacher_Database');
  };

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
        password: signupForm.pass,
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
              {getMySubstitutionsToday().length > 0 && (
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }} 
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-indigo-600 p-8 rounded-[2rem] text-white shadow-2xl relative overflow-hidden"
                >
                  <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-md">
                        <Sparkles className="w-8 h-8" />
                      </div>
                      <h2 className="text-3xl font-black">Today's Substitution Alert!</h2>
                    </div>
                    <p className="text-indigo-100 mb-6 font-medium">You have been assigned as a substitute for the following classes today:</p>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {getMySubstitutionsToday().map((sub, idx) => (
                        <div key={idx} className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20">
                          <div className="flex justify-between items-center mb-2">
                            <span className="bg-white text-indigo-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">Bell {sub.bell}</span>
                            <span className="text-xs font-bold">Class {sub.class}</span>
                          </div>
                          <p className="text-sm opacity-80">Substituting for:</p>
                          <p className="font-bold text-lg">{sub.absentTeacherName}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl"></div>
                </motion.div>
              )}

              <div className="grid md:grid-cols-4 gap-6">
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

                {/* Student Attendance Box (Only for Class Teachers) */}
                {schoolSettings.classes.some(cls => isClassTeacherOf(cls)) && (
                  <div 
                    onClick={() => setActiveTeacherSection(activeTeacherSection === 'student-attendance' ? null : 'student-attendance')}
                    className={`p-8 rounded-3xl cursor-pointer transition-all transform hover:scale-105 shadow-sm border-2 ${activeTeacherSection === 'student-attendance' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-800 border-gray-100'}`}
                  >
                    <UserPlus className={`w-12 h-12 mb-4 ${activeTeacherSection === 'student-attendance' ? 'text-white' : 'text-indigo-600'}`} />
                    <h3 className="text-2xl font-bold">Students</h3>
                    <p className={`text-sm mt-2 ${activeTeacherSection === 'student-attendance' ? 'text-indigo-100' : 'text-gray-500'}`}>Daily student details</p>
                  </div>
                )}
              </div>

              {/* Content Area */}
              <AnimatePresence mode="wait">
                {activeTeacherSection === 'student-attendance' && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                    <Card title="Daily Student Attendance Upload" icon={UserPlus}>
                      <div className="max-w-4xl mx-auto py-6">
                        <div className="grid md:grid-cols-2 gap-8">
                          <div className="space-y-6">
                            <h4 className="text-lg font-bold text-indigo-900">Select Your Class</h4>
                            <div className="grid grid-cols-2 gap-4">
                              {schoolSettings.classes.filter(cls => isClassTeacherOf(cls)).map(cls => (
                                <button 
                                  key={cls}
                                  onClick={() => setStudentAttForm({ ...studentAttForm, class: cls })}
                                  className={`p-6 rounded-3xl border-2 font-black text-xl transition-all ${studentAttForm.class === cls ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white text-gray-400 border-gray-100 hover:border-indigo-200'}`}
                                >
                                  Class {cls}
                                </button>
                              ))}
                            </div>
                          </div>

                          {studentAttForm.class && (
                            <div className="bg-gray-50 p-8 rounded-[2.5rem] border-2 border-white shadow-inner space-y-6">
                              <h4 className="text-xl font-black text-indigo-900">Attendance for Class {studentAttForm.class}</h4>
                              <div className="space-y-4">
                                <div>
                                  <label className="text-xs font-bold text-gray-500 uppercase ml-2">Total Students</label>
                                  <input 
                                    type="number" className="w-full p-4 rounded-2xl border-2 border-white shadow-sm focus:border-indigo-600 outline-none"
                                    value={studentAttForm.total} onChange={e => setStudentAttForm({ ...studentAttForm, total: parseInt(e.target.value) || 0 })}
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className="text-xs font-bold text-green-600 uppercase ml-2">Present</label>
                                    <input 
                                      type="number" className="w-full p-4 rounded-2xl border-2 border-white shadow-sm focus:border-green-600 outline-none"
                                      value={studentAttForm.present} onChange={e => setStudentAttForm({ ...studentAttForm, present: parseInt(e.target.value) || 0 })}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs font-bold text-red-600 uppercase ml-2">Absent</label>
                                    <input 
                                      type="number" className="w-full p-4 rounded-2xl border-2 border-white shadow-sm focus:border-red-600 outline-none"
                                      value={studentAttForm.absent} onChange={e => setStudentAttForm({ ...studentAttForm, absent: parseInt(e.target.value) || 0 })}
                                    />
                                  </div>
                                </div>
                                <button 
                                  onClick={() => submitStudentAttendance(studentAttForm.class, studentAttForm.total, studentAttForm.present, studentAttForm.absent)}
                                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-xl hover:bg-indigo-700 transition-all transform hover:-translate-y-1"
                                >
                                  Upload Details
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                )}
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
                      <div className="space-y-6">
                        <div className="grid grid-cols-7 gap-2 text-center">
                          <div className="text-[10px] font-black text-gray-400 uppercase">Bell</div>
                          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                            <div key={d} className="text-[10px] font-black text-indigo-900 uppercase">{d}</div>
                          ))}
                        </div>
                        <div className="space-y-2">
                          {[1, 2, 3, 4, 5, 6].map(bell => (
                            <div key={bell} className="grid grid-cols-7 gap-2">
                              <div className="flex items-center justify-center bg-gray-50 rounded-lg border border-gray-100 text-[10px] font-black text-gray-400">
                                {bell}
                              </div>
                              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => {
                                const entry = fullTimetable.find(t => t.teacherId === user?.uid && t.day === day && t.bell === bell);
                                return (
                                  <div key={day} className={`p-2 rounded-xl border text-[8px] flex flex-col items-center justify-center min-h-[60px] transition-all ${entry ? 'bg-indigo-50 border-indigo-100 shadow-sm' : 'bg-gray-50 border-gray-100 opacity-30'}`}>
                                    {entry ? (
                                      <>
                                        <span className="font-black text-indigo-700 mb-1">Class {entry.class}</span>
                                        <span className="text-gray-600 text-center leading-tight">{entry.subject}</span>
                                      </>
                                    ) : (
                                      <span className="text-gray-300">--</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
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
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <button 
                  onClick={() => setActiveAdminSection(activeAdminSection === 'dashboard' ? null : 'dashboard')}
                  className={`p-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${activeAdminSection === 'dashboard' || !activeAdminSection ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border-2 border-indigo-50 hover:bg-indigo-50'}`}
                >
                  <LayoutDashboard className="w-5 h-5" /> Dashboard
                </button>
                <button 
                  onClick={() => setActiveAdminSection(activeAdminSection === 'arrangement' ? null : 'arrangement')}
                  className={`p-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${activeAdminSection === 'arrangement' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border-2 border-indigo-50 hover:bg-indigo-50'}`}
                >
                  <Calendar className="w-5 h-5" /> Arrangement
                </button>
                <button 
                  onClick={() => setActiveAdminSection(activeAdminSection === 'teachers' ? null : 'teachers')}
                  className={`p-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${activeAdminSection === 'teachers' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border-2 border-indigo-50 hover:bg-indigo-50'}`}
                >
                  <Users className="w-5 h-5" /> Teacher List
                </button>
                <button 
                  onClick={() => setActiveAdminSection(activeAdminSection === 'students' ? null : 'students')}
                  className={`p-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${activeAdminSection === 'students' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border-2 border-indigo-50 hover:bg-indigo-50'}`}
                >
                  <UserPlus className="w-5 h-5" /> Students Present
                </button>
                <button 
                  onClick={() => setActiveAdminSection(activeAdminSection === 'timetable' ? null : 'timetable')}
                  className={`p-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${activeAdminSection === 'timetable' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border-2 border-indigo-50 hover:bg-indigo-50'}`}
                >
                  <Clock className="w-5 h-5" /> Time Table
                </button>
              </div>

              <AnimatePresence mode="wait">
                {(activeAdminSection === 'dashboard' || !activeAdminSection) && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="space-y-8">
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

                    <Card title="School Settings" icon={Settings}>
                      <div className="grid md:grid-cols-2 gap-8 py-4">
                        <div className="space-y-4">
                          <h4 className="text-sm font-bold text-gray-500 uppercase">Manage Subjects</h4>
                          <div className="flex flex-wrap gap-2">
                            {schoolSettings.subjects.map(s => (
                              <span key={s} className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold flex items-center gap-2">
                                {s} <X className="w-3 h-3 cursor-pointer" onClick={() => setSchoolSettings({...schoolSettings, subjects: schoolSettings.subjects.filter(sub => sub !== s)})} />
                              </span>
                            ))}
                            <button className="px-3 py-1 border-2 border-dashed border-indigo-200 text-indigo-400 rounded-full text-xs font-bold hover:border-indigo-400 hover:text-indigo-600 transition-all">+ Add</button>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <h4 className="text-sm font-bold text-gray-500 uppercase">Manage Classes</h4>
                          <div className="flex flex-wrap gap-2">
                            {schoolSettings.classes.map(c => (
                              <span key={c} className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-xs font-bold flex items-center gap-2">
                                Class {c} <X className="w-3 h-3 cursor-pointer" onClick={() => setSchoolSettings({...schoolSettings, classes: schoolSettings.classes.filter(cls => cls !== c)})} />
                              </span>
                            ))}
                            <button className="px-3 py-1 border-2 border-dashed border-green-200 text-green-400 rounded-full text-xs font-bold hover:border-green-400 hover:text-green-600 transition-all">+ Add</button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                )}
                {activeAdminSection === 'arrangement' && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="space-y-6">
                    <div className="flex flex-wrap gap-4 mb-6">
                      <button 
                        onClick={() => setActiveArrangementSubSection('view')}
                        className={`px-6 py-3 rounded-2xl font-black text-sm transition-all ${activeArrangementSubSection === 'view' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border-2 border-indigo-50 hover:bg-indigo-50'}`}
                      >
                        View Previous Arrangement
                      </button>
                      <button 
                        onClick={() => setActiveArrangementSubSection('generate')}
                        className={`px-6 py-3 rounded-2xl font-black text-sm transition-all ${activeArrangementSubSection === 'generate' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border-2 border-indigo-50 hover:bg-indigo-50'}`}
                      >
                        Generate/View Today
                      </button>
                      <button 
                        onClick={() => setActiveArrangementSubSection('leaves')}
                        className={`px-6 py-3 rounded-2xl font-black text-sm transition-all ${activeArrangementSubSection === 'leaves' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border-2 border-indigo-50 hover:bg-indigo-50'}`}
                      >
                        View Leave Requests
                      </button>
                    </div>

                    {activeArrangementSubSection === 'view' && (
                      <Card title="Previous Arrangements" icon={Calendar}>
                        <div className="grid md:grid-cols-3 gap-4 mb-8">
                          <button 
                            onClick={() => setArrangementDate(subDays(arrangementDate, 1))}
                            className="p-4 bg-gray-50 rounded-2xl text-sm font-bold hover:bg-gray-100 flex flex-col items-center gap-2"
                          >
                            <ChevronLeft className="w-6 h-6 text-indigo-600" />
                            Previous Day
                          </button>
                          <div className="p-4 bg-indigo-600 text-white rounded-2xl text-center flex flex-col justify-center">
                            <p className="text-[10px] font-bold opacity-80 uppercase">{format(arrangementDate, 'EEEE')}</p>
                            <p className="text-xl font-black">{format(arrangementDate, 'dd MMM yyyy')}</p>
                          </div>
                          <button 
                            onClick={() => setArrangementDate(addDays(arrangementDate, 1))}
                            className="p-4 bg-gray-50 rounded-2xl text-sm font-bold hover:bg-gray-100 flex flex-col items-center gap-2"
                          >
                            <ChevronRight className="w-6 h-6 text-indigo-600" />
                            Next Day
                          </button>
                        </div>

                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {arrangements.filter(a => a.date === format(arrangementDate, 'yyyy-MM-dd')).flatMap(a => a.absentTeachers).map((at, idx) => (
                            <div key={idx} className="bg-white border-2 border-indigo-50 rounded-3xl p-6 shadow-sm">
                              <div className="flex items-center gap-3 mb-4 border-b pb-4">
                                <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center text-red-600">
                                  <UserX className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Absent Teacher</p>
                                  <h5 className="font-black text-indigo-950">{at.teacherName}</h5>
                                </div>
                              </div>
                              <table className="w-full text-[10px]">
                                <thead>
                                  <tr className="text-gray-400 border-b">
                                    <th className="pb-2 text-left">Bell</th>
                                    <th className="pb-2 text-left">Class</th>
                                    <th className="pb-2 text-left">Substitute</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {at.substitutions.map((s, i) => (
                                    <tr key={i} className="border-b last:border-0">
                                      <td className="py-2 font-bold text-indigo-600">{s.bell}</td>
                                      <td className="py-2 font-medium">{s.class}</td>
                                      <td className="py-2 font-black text-gray-700">{s.substituteName}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                          {arrangements.filter(a => a.date === format(arrangementDate, 'yyyy-MM-dd')).length === 0 && (
                            <div className="col-span-full py-12 text-center text-gray-400 bg-gray-50 rounded-3xl border-2 border-dashed">
                              <Calendar className="w-12 h-12 mx-auto mb-4 opacity-20" />
                              <p>No arrangements found for this date.</p>
                            </div>
                          )}
                        </div>
                      </Card>
                    )}

                    {activeArrangementSubSection === 'generate' && (
                      <Card title="Today's Arrangement" icon={Sparkles}>
                        <div className="space-y-6">
                          <div className="flex justify-between items-center">
                            <h4 className="font-bold text-indigo-900">Today: {format(new Date(), 'dd MMM yyyy')}</h4>
                            {arrangements.some(a => a.date === format(new Date(), 'yyyy-MM-dd')) ? (
                              <span className="bg-green-100 text-green-600 px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4" /> Already Generated
                              </span>
                            ) : (
                              <button 
                                onClick={handleGenerateArrangement}
                                className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-md flex items-center gap-2"
                              >
                                <Sparkles className="w-4 h-4" /> Generate Today's Arrangement
                              </button>
                            )
                          }
                          </div>

                          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {arrangements.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).flatMap(a => a.absentTeachers).map((at, idx) => (
                              <div key={idx} className="bg-white border-2 border-indigo-50 rounded-3xl p-6 shadow-sm">
                                <div className="flex items-center gap-3 mb-4 border-b pb-4">
                                  <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center text-red-600">
                                    <UserX className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Absent Teacher</p>
                                    <h5 className="font-black text-indigo-950">{at.teacherName}</h5>
                                  </div>
                                </div>
                                <table className="w-full text-[10px]">
                                  <thead>
                                    <tr className="text-gray-400 border-b">
                                      <th className="pb-2 text-left">Bell</th>
                                      <th className="pb-2 text-left">Class</th>
                                      <th className="pb-2 text-left">Substitute</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {at.substitutions.map((s, i) => (
                                      <tr key={i} className="border-b last:border-0">
                                        <td className="py-2 font-bold text-indigo-600">{s.bell}</td>
                                        <td className="py-2 font-medium">{s.class}</td>
                                        <td className="py-2 font-black text-gray-700">{s.substituteName}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                            {arrangements.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).length === 0 && (
                              <div className="col-span-full py-12 text-center text-gray-400 bg-gray-50 rounded-3xl border-2 border-dashed">
                                <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                <p>Today's arrangement has not been generated yet.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    )}

                    {activeArrangementSubSection === 'leaves' && (
                      <Card title="Leave Requests" icon={FileText}>
                        <div className="grid md:grid-cols-2 gap-6">
                          {leaves.sort((a, b) => b.startDate.localeCompare(a.startDate)).map(leave => (
                            <div key={leave.id} className={`p-6 rounded-3xl border-2 transition-all ${leave.status === 'pending' ? 'border-orange-100 bg-orange-50/30' : leave.status === 'approved' ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`}>
                              <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${leave.status === 'pending' ? 'bg-orange-100 text-orange-600' : leave.status === 'approved' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                    <Users className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <h5 className="font-bold text-gray-900">{leave.teacherName}</h5>
                                    <p className="text-xs text-gray-500">{leave.mobile}</p>
                                  </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${leave.status === 'pending' ? 'bg-orange-100 text-orange-600' : leave.status === 'approved' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                  {leave.status}
                                </span>
                              </div>
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                  <Calendar className="w-4 h-4" />
                                  <span>{format(new Date(leave.startDate), 'dd MMM')} - {format(new Date(leave.endDate), 'dd MMM yyyy')}</span>
                                </div>
                                <p className="text-sm text-gray-700 bg-white/50 p-3 rounded-xl border border-gray-100 italic">"{leave.reason}"</p>
                                
                                {leave.status === 'pending' && (
                                  <div className="flex gap-2 pt-2">
                                    <button 
                                      onClick={() => setDoc(doc(db, 'leaves', leave.id), { ...leave, status: 'approved' })}
                                      className="flex-1 py-2 bg-green-600 text-white rounded-xl font-bold text-xs hover:bg-green-700 transition-all"
                                    >
                                      Approve
                                    </button>
                                    <button 
                                      onClick={() => setDoc(doc(db, 'leaves', leave.id), { ...leave, status: 'rejected' })}
                                      className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold text-xs hover:bg-red-700 transition-all"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </motion.div>
                )}

                {activeAdminSection === 'teachers' && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                    <Card title="Teacher Database" icon={Users}>
                      <div className="flex justify-end mb-6">
                        <button 
                          onClick={exportTeacherList}
                          className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-lg flex items-center gap-2"
                        >
                          <Download className="w-5 h-5" /> Download Teacher List (Excel)
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500 text-left">
                              <th className="p-4 rounded-l-xl">Teacher Name</th>
                              <th className="p-4">ID / Password</th>
                              <th className="p-4">Classes / Subjects</th>
                              <th className="p-4">Attendance (M/S)</th>
                              <th className="p-4 rounded-r-xl">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allTeachers.map(t => {
                              const today = new Date();
                              const monthStart = startOfMonth(today);
                              const sessionStart = new Date(today.getFullYear(), 3, 1);
                              if (today < sessionStart) sessionStart.setFullYear(today.getFullYear() - 1);
                              
                              const attMonth = allAttendance.filter(a => a.teacherId === t.uid && a.date >= format(monthStart, 'yyyy-MM-dd')).length;
                              const attSession = allAttendance.filter(a => a.teacherId === t.uid && a.date >= format(sessionStart, 'yyyy-MM-dd')).length;
                              
                              return (
                                <tr key={t.uid} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                                  <td className="p-4 font-bold text-indigo-950">{t.name}</td>
                                  <td className="p-4">
                                    <p className="text-xs font-mono text-gray-600">{t.email.split('@')[0]}</p>
                                    <p className="text-[10px] font-mono text-gray-400">{t.password || '******'}</p>
                                  </td>
                                  <td className="p-4">
                                    <p className="text-[10px] font-bold text-indigo-600">{t.classes?.join(', ')}</p>
                                    <p className="text-[10px] text-gray-500">{t.subjects?.join(', ')}</p>
                                  </td>
                                  <td className="p-4">
                                    <div className="flex gap-2">
                                      <span className="px-2 py-1 bg-green-50 text-green-600 rounded-md text-[10px] font-black">M: {attMonth}</span>
                                      <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-md text-[10px] font-black">S: {attSession}</span>
                                    </div>
                                  </td>
                                  <td className="p-4">
                                    <button className="text-red-500 hover:text-red-700"><UserX className="w-5 h-5" /></button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </motion.div>
                )}

                {activeAdminSection === 'students' && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                    <Card title="Student Attendance Details" icon={UserPlus}>
                      <div className="flex justify-end mb-6">
                        <button 
                          onClick={() => exportToExcel(studentAttendance, 'Student_Attendance_Report')}
                          className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-lg flex items-center gap-2"
                        >
                          <Download className="w-5 h-5" /> Download Report
                        </button>
                      </div>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {schoolSettings.classes.map(cls => {
                          const classData = studentAttendance.filter(s => s.class === cls).sort((a, b) => b.date.localeCompare(a.date));
                          return (
                            <div key={cls} className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
                              <h5 className="text-lg font-black text-indigo-900 mb-4 border-b pb-2">Class {cls}</h5>
                              <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                                {classData.map((s, i) => (
                                  <div key={i} className="p-3 bg-gray-50 rounded-xl text-[10px]">
                                    <div className="flex justify-between font-bold mb-1">
                                      <span>{format(new Date(s.date), 'dd MMM yyyy')}</span>
                                      <span className="text-indigo-600">By {s.teacherName}</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                      <div className="bg-white p-1 rounded border">Total: {s.totalStudents}</div>
                                      <div className="bg-green-50 p-1 rounded border border-green-100 text-green-600">P: {s.present}</div>
                                      <div className="bg-red-50 p-1 rounded border border-red-100 text-red-600">A: {s.absent}</div>
                                    </div>
                                  </div>
                                ))}
                                {classData.length === 0 && <p className="text-center text-gray-400 py-4">No data uploaded yet.</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  </motion.div>
                )}

                {activeAdminSection === 'timetable' && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                    <Card title="Master Time Table" icon={Clock}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[10px] border-collapse">
                          <thead>
                            <tr className="bg-gray-50 border-b">
                              <th className="p-3 text-left border-r sticky left-0 bg-gray-50 z-10">Class</th>
                              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                                <th key={day} className="p-2 border-r text-center font-black text-indigo-900">{day}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {schoolSettings.classes.map(cls => (
                              <tr key={cls} className="border-b hover:bg-gray-50">
                                <td className="p-3 border-r sticky left-0 bg-white z-10 font-black">Class {cls}</td>
                                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                                  <td key={day} className="p-1 border-r">
                                    <div className="space-y-1">
                                      {[1, 2, 3, 4, 5, 6, 7, 8].map(bell => {
                                        const entry = fullTimetable.find(t => t.class === cls && t.day === day && t.bell === bell);
                                        return entry ? (
                                          <div key={bell} className="p-1 bg-indigo-50 rounded text-[8px] border border-indigo-100">
                                            <span className="font-bold text-indigo-700">B{bell}:</span> {entry.subject} ({entry.teacherName})
                                          </div>
                                        ) : null;
                                      })}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

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
                            <div className="space-y-2">
                              <button 
                                onClick={() => handleAISubstitution(leave)}
                                disabled={loadingAI}
                                className="w-full py-2 bg-indigo-600 text-white rounded-xl font-bold text-xs hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                              >
                                <Sparkles className="w-4 h-4" /> {loadingAI ? 'Analyzing...' : 'AI Suggest Substitution'}
                              </button>
                              
                              {substitutionSuggestions.length > 0 && (
                                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 space-y-3">
                                  <p className="text-[10px] font-black text-indigo-900 uppercase flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> AI Suggestions for Today:
                                  </p>
                                  {substitutionSuggestions.map((s, i) => (
                                    <div key={i} className="text-[10px] bg-white p-2 rounded-lg border border-indigo-50">
                                      <p className="font-bold text-indigo-700">Bell {s.bell}: Class {s.class}</p>
                                      <p className="text-gray-600">Substitute: <span className="font-black">{s.suggestedTeacher}</span></p>
                                      <p className="text-[8px] text-gray-400 mt-1 italic">{s.reason}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
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
                        <button 
                          onClick={handleGenerateTimetable}
                          disabled={isGeneratingAI}
                          className="w-full py-3 bg-white text-indigo-600 rounded-xl font-black hover:bg-indigo-50 transition-all shadow-lg disabled:opacity-50"
                        >
                          {isGeneratingAI ? 'Generating...' : 'AI Generate Time Table'}
                        </button>
                      </div>
                      
                      <div className="space-y-4 border-t pt-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-gray-700">Class Subject Requirements</h4>
                          <span className="text-[10px] bg-indigo-100 px-2 py-1 rounded-md text-indigo-600 font-bold">AI INPUT</span>
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                          {schoolSettings.classes.map(cls => (
                            <div key={cls} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                              <p className="text-xs font-black text-indigo-900 mb-2 uppercase">Class {cls}</p>
                              <div className="grid grid-cols-2 gap-2">
                                {schoolSettings.subjects.map(sub => {
                                  const req = subjectRequirements.find(r => r.class === cls && r.subject === sub);
                                  return (
                                    <div key={sub} className="flex items-center justify-between bg-white p-2 rounded-lg border border-gray-100">
                                      <span className="text-[10px] font-bold text-gray-600">{sub}</span>
                                      <input 
                                        type="number" 
                                        min="0" max="6"
                                        className="w-10 text-center text-[10px] font-black border-b border-indigo-200 outline-none"
                                        value={req?.frequencyPerWeek || 0}
                                        onChange={(e) => updateRequirement({ class: cls, subject: sub, frequencyPerWeek: parseInt(e.target.value) || 0 })}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
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
