import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, Calendar, Clock, Download, Plus, X, Search, 
  Menu, LogOut, LayoutDashboard, UserCheck, UserX, 
  FileText, Sparkles, ChevronLeft, ChevronRight, 
  Settings, ShieldCheck, Mail, Lock, Phone, UserPlus,
  CalendarCheck, AlertCircle, Trash2, Save, Filter,
  CheckCircle2, Info, ArrowUpRight, GraduationCap
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
  signOut, GoogleAuthProvider, signInWithPopup 
} from 'firebase/auth';
import { 
  format, startOfMonth, endOfMonth, eachDayOfInterval, 
  isPast, isToday, addMonths, subMonths, getDay, 
  parseISO, isAfter, startOfDay, endOfDay, addDays, subDays
} from 'date-fns';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { generateTimetableAI, suggestSubstitutionAI, TimetableEntry, SubjectRequirement } from './services/geminiService';
import firebaseConfig from '../firebase-applet-config.json';

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// --- Types ---
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
  class: string;
  date: string;
  totalStudents: number;
  present: number;
  absent: number;
  teacherName: string;
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
  const [view, setView] = useState<'home' | 'loginSelection' | 'teacherLogin' | 'adminLogin' | 'teacherPortal' | 'adminPortal'>('home');
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

  // UI States
  const [activeAdminSection, setActiveAdminSection] = useState<'dashboard' | 'attendance' | 'arrangement' | 'teachers' | 'timetable'>('dashboard');
  const [activeArrangementTab, setActiveArrangementTab] = useState<'view' | 'generate' | 'leaves'>('generate');
  const [activeTimetableSubSection, setActiveTimetableSubSection] = useState<'view' | 'generate'>('view');
  const [timetableViewState, setTimetableViewState] = useState<'teacher' | 'class'>('teacher');
  const [activeTimetableView, setActiveTimetableView] = useState<'teacher' | 'class'>('teacher');
  const [arrangementDate, setArrangementDate] = useState<Date>(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Form States
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [attendanceCode, setAttendanceCode] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [substitutionSuggestions, setSubstitutionSuggestions] = useState<any[]>([]);

  // --- Auth Handlers ---

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const snap = await getDoc(doc(db, 'users', u.uid));
        if (snap.exists()) {
          const profile = snap.data() as Teacher;
          setUserProfile(profile);
          setView(profile.role === 'admin' ? 'adminPortal' : 'teacherPortal');
        } else if (u.email === 'jitendrakumart557@gmail.com') {
          // Auto-provision admin
          const profile: Teacher = {
            uid: u.uid,
            name: 'Master Admin',
            email: u.email!,
            mobile: '0000000000',
            classes: [],
            subjects: [],
            role: 'admin'
          };
          await setDoc(doc(db, 'users', u.uid), profile);
          setUserProfile(profile);
          setView('adminPortal');
        }
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
    } catch (err: any) {
      alert("Login Error: " + err.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setView('home');
    setUserProfile(null);
  };

  // --- Data Loading Handlers ---

  useEffect(() => {
    if (!user || (userProfile?.role !== 'admin' && userProfile?.role !== 'teacher')) return;

    const unsubTeachers = onSnapshot(collection(db, 'users'), (snap) => {
      setAllTeachers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as Teacher)));
    });

    const unsubAttendance = onSnapshot(collection(db, 'attendance'), (snap) => {
      setAttendance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceRecord)));
    });

    const unsubLeaves = onSnapshot(collection(db, 'leaves'), (snap) => {
      setLeaves(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LeaveRequest)));
    });

    const unsubArrangements = onSnapshot(collection(db, 'arrangements'), (snap) => {
      setArrangements(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Arrangement)));
    });

    const unsubStudentAtt = onSnapshot(collection(db, 'studentAttendance'), (snap) => {
      setStudentAttendance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StudentAttendance)));
    });

    const unsubHolidays = onSnapshot(collection(db, 'holidays'), (snap) => {
      setHolidays(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Holiday)));
    });

    const unsubTimetable = onSnapshot(doc(db, 'settings', 'timetable'), (snap) => {
      if (snap.exists()) setTimetable(snap.data().entries || []);
    });

    const unsubRequirements = onSnapshot(doc(db, 'settings', 'subjectRequirements'), (snap) => {
      if (snap.exists()) setSubjectRequirements(snap.data().requirements || []);
    });

    const unsubSettings = onSnapshot(doc(db, 'settings', 'school'), (snap) => {
      if (snap.exists()) setSchoolSettings(snap.data() as SchoolSettings);
    });

    const unsubCode = onSnapshot(query(collection(db, 'attendanceCodes'), orderBy('createdAt', 'desc'), limit(1)), (snap) => {
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
      unsubTeachers();
      unsubAttendance();
      unsubLeaves();
      unsubArrangements();
      unsubStudentAtt();
      unsubHolidays();
      unsubTimetable();
      unsubRequirements();
      unsubSettings();
      unsubCode();
    };
  }, [user, userProfile]);

  // --- Admin Logic ---

  const markTodayAsHoliday = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const isSunday = getDay(new Date()) === 0;
    const defaultReason = isSunday ? 'Sunday' : '';
    
    const reason = prompt("Enter holiday reason (or space for vertical list):", defaultReason);
    if (reason === null) return;

    try {
      await setDoc(doc(db, 'holidays', today), {
        date: today,
        reason: reason || (isSunday ? 'Sunday' : 'Holiday')
      });
      alert("Holiday Marked!");
    } catch (err) {
      alert("Error marking holiday.");
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

            <div className="overflow-x-auto border-2 border-indigo-50/50 rounded-2xl">
              {timetableViewState === 'teacher' ? (
                <table className="w-full text-[10px] border-collapse">
                  <thead className="bg-indigo-50/50">
                    <tr>
                      <th className="p-3 text-left font-black border-b border-r sticky left-0 bg-indigo-50/50 z-10">Teacher</th>
                      {daysArr.map(day => (
                        <th key={day} className="p-2 border-b border-r text-center font-black min-w-[120px]">{day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allTeachers.map(teacher => (
                      <tr key={teacher.uid} className="hover:bg-indigo-50/30">
                        <td className="p-3 border-b border-r font-bold sticky left-0 bg-white z-10">{teacher.name}</td>
                        {daysArr.map(day => (
                          <td key={day} className="p-2 border-b border-r align-top">
                            <div className="space-y-1">
                              {[1, 2, 3, 4, 5, 6, 7, 8].map(bell => {
                                const entry = timetable.find(e => e.teacherId === teacher.uid && e.day === day && e.bell === bell);
                                if (!entry) return null;
                                return (
                                  <div key={bell} className="bg-indigo-50 p-1 rounded border border-indigo-100">
                                    <span className="font-bold text-indigo-700">Bell {bell}:</span> Class {entry.class}{entry.section}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-[10px] border-collapse">
                  <thead className="bg-indigo-50/50">
                    <tr>
                      <th className="p-3 text-left font-black border-b border-r sticky left-0 bg-indigo-50/50 z-10">Class</th>
                      {daysArr.map(day => (
                        <th key={day} className="p-2 border-b border-r text-center font-black min-w-[120px]">{day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FLattenClasses.map(cls => (
                      <tr key={cls} className="hover:bg-indigo-50/30">
                        <td className="p-3 border-b border-r font-bold sticky left-0 bg-white z-10">Class {cls}</td>
                        {daysArr.map(day => (
                          <td key={day} className="p-2 border-b border-r align-top">
                            <div className="space-y-1">
                              {[1, 2, 3, 4, 5, 6, 7, 8].map(bell => {
                                const level = cls.slice(0, -1);
                                const section = cls.slice(-1);
                                const entry = timetable.find(e => e.class === level && e.section === section && e.day === day && e.bell === bell);
                                if (!entry) return null;
                                return (
                                  <div key={bell} className="bg-green-50 p-1 rounded border border-green-100">
                                    <span className="font-bold text-green-700">Bell {bell}:</span> {entry.subject}<br/>
                                    <span className="text-[8px] text-gray-500 italic">{entry.teacherName}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
    <div className="min-h-screen bg-[#F8FAFF] font-sans text-gray-900 pb-20 overflow-x-hidden">
      {/* Navigation */}
      <nav className="bg-white border-b border-indigo-50 sticky top-0 z-50 backdrop-blur-md bg-white/80">
        <div className="max-w-7xl mx-auto px-6 h-20 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-600/30">
              <GraduationCap className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-black text-indigo-950 leading-tight">SSM DIGITAL</h1>
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">School Management System</p>
            </div>
          </div>
          
          {userProfile && (
            <div className="flex items-center gap-4">
              <div className="hidden md:block text-right">
                <p className="text-sm font-black text-indigo-950">{userProfile.name}</p>
                <p className="text-[10px] font-bold text-indigo-400 uppercase">{userProfile.role}</p>
              </div>
              <button 
                onClick={handleLogout}
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
          {view === 'home' && (
            <motion.div key="home" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} className="min-h-[70vh] flex flex-col items-center justify-center text-center">
              <div className="mb-8 relative">
                <div className="absolute -inset-10 bg-indigo-600/10 rounded-full blur-3xl"></div>
                <GraduationCap className="w-24 h-24 text-indigo-600 relative" />
              </div>
              <h2 className="text-5xl font-black text-indigo-950 mb-4">Saraswati Shishu Mandir</h2>
              <p className="text-gray-500 max-w-lg mb-12 text-lg font-medium leading-relaxed">
                Empowering education through seamless digital management. Secure portals for teachers and administrators.
              </p>
              <div className="flex flex-col md:flex-row gap-6 w-full max-w-md">
                <button 
                  onClick={() => setView('loginSelection')}
                  className="flex-1 bg-indigo-600 text-white px-8 py-5 rounded-3xl font-black text-lg hover:bg-indigo-700 hover:shadow-2xl hover:shadow-indigo-600/20 hover:-translate-y-1 transition-all flex items-center justify-center gap-3"
                >
                  Enter Portal <ArrowUpRight className="w-6 h-6" />
                </button>
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
                    <label className="text-[10px] font-black text-indigo-400 uppercase ml-2">Official Email</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                      <input 
                        type="email" required placeholder="name@ssm.portal" 
                        className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-indigo-50 rounded-2xl outline-none focus:border-indigo-600 transition-all"
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
                        className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-indigo-50 rounded-2xl outline-none focus:border-indigo-600 transition-all"
                        value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                      />
                    </div>
                  </div>
                  <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all uppercase tracking-widest text-sm">
                    Access Portal
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
                <div className="space-y-8">
                  <div className="flex justify-center mb-4">
                    <div className="bg-white p-2 rounded-[2rem] shadow-sm border border-indigo-50 flex gap-2">
                      <button onClick={() => setActiveArrangementTab('generate')} className={`px-8 py-3 rounded-3xl font-black text-xs transition-all ${activeArrangementTab === 'generate' ? 'bg-indigo-600 text-white shadow-xl' : 'text-gray-400 hover:bg-gray-50'}`}>GENERATE TODAY</button>
                      <button onClick={() => setActiveArrangementTab('view')} className={`px-8 py-3 rounded-3xl font-black text-xs transition-all ${activeArrangementTab === 'view' ? 'bg-indigo-600 text-white shadow-xl' : 'text-gray-400 hover:bg-gray-50'}`}>VIEW ARCHIVE</button>
                      <button onClick={() => setActiveArrangementTab('leaves')} className={`px-8 py-3 rounded-3xl font-black text-xs transition-all ${activeArrangementTab === 'leaves' ? 'bg-indigo-600 text-white shadow-xl' : 'text-gray-400 hover:bg-gray-50'}`}>LEAVE REQUESTS</button>
                    </div>
                  </div>

                  {activeArrangementTab === 'view' && (
                    <Card title="Arrangement Archive" icon={History} headerAction={
                      <div className="flex items-center gap-4 bg-white/10 p-1 rounded-xl">
                         <button onClick={() => setArrangementDate(subDays(arrangementDate, 1))} className="p-1 hover:bg-white/20 rounded text-white"><ChevronLeft className="w-4 h-4"/></button>
                         <span className="text-xs font-black text-white min-w-[120px] text-center">{format(arrangementDate, 'dd MMM yyyy').toUpperCase()}</span>
                         <button onClick={() => setArrangementDate(addDays(arrangementDate, 1))} className="p-1 hover:bg-white/20 rounded text-white"><ChevronRight className="w-4 h-4"/></button>
                      </div>
                    }>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {arrangements.filter(a => a.date === format(arrangementDate, 'yyyy-MM-dd')).flatMap(a => a.absentTeachers).map((at, idx) => (
                           <div key={idx} className="bg-white border-2 border-indigo-50 rounded-3xl p-6 shadow-sm overflow-hidden relative">
                             <div className="flex items-center gap-4 mb-4 border-b pb-4">
                               <div className="w-10 h-10 bg-red-50 text-red-500 rounded-full flex items-center justify-center">
                                 <UserX className="w-5 h-5"/>
                               </div>
                               <div>
                                 <p className="text-[10px] font-black text-gray-400 uppercase">Absent Teacher</p>
                                 <h5 className="font-bold text-indigo-950">{at.teacherName}</h5>
                               </div>
                             </div>
                             <table className="w-full text-[10px]">
                               <thead>
                                 <tr className="text-gray-400 border-b">
                                   <th className="pb-2 text-left">BELL</th>
                                   <th className="pb-2 text-left">CLASS</th>
                                   <th className="pb-2 text-left">SUBSTITUTE</th>
                                 </tr>
                               </thead>
                               <tbody>
                                 {at.substitutions.map((s, i) => (
                                   <tr key={i} className="border-b last:border-0">
                                     <td className="py-2 font-black text-indigo-600">B{s.bell}</td>
                                     <td className="py-2 font-bold">{s.class}</td>
                                     <td className="py-2 font-black text-gray-700">{s.substituteName}</td>
                                   </tr>
                                 ))}
                               </tbody>
                             </table>
                           </div>
                        ))}
                        {arrangements.filter(a => a.date === format(arrangementDate, 'yyyy-MM-dd')).length === 0 && (
                          <div className="col-span-full py-20 text-center text-gray-400 italic">No arrangements for this date.</div>
                        )}
                      </div>
                    </Card>
                  )}

                  {activeArrangementTab === 'generate' && (
                    <div className="space-y-8">
                       <Card title="Live Arrangement Feed" icon={Sparkles}>
                         <div className="flex justify-between items-center mb-6">
                           <h4 className="font-black text-indigo-950">TODAY: {format(new Date(), 'dd MMM yyyy')}</h4>
                           <button 
                             onClick={async () => {
                               // Generate logic
                               const today = format(new Date(), 'yyyy-MM-dd');
                               const todayName = format(new Date(), 'EEEE');
                               const absentTeachers = leaves
                                 .filter(l => l.status === 'approved' && today >= l.startDate && today <= l.endDate)
                                 .map(l => ({ teacherId: l.teacherId, teacherName: l.teacherName }));
                               
                               if (absentTeachers.length === 0) return alert("No approved leaves for today.");

                               const teacherList = absentTeachers.map(at => {
                                  const tt = timetable.filter(entry => entry.teacherId === at.teacherId && entry.day === todayName);
                                  return {
                                    teacherId: at.teacherId,
                                    teacherName: at.teacherName,
                                    substitutions: tt.map(entry => {
                                      // Simple substitution: first available teacher
                                      const level = entry.class;
                                      const section = entry.section;
                                      const freeTeacher = allTeachers.find(t => 
                                        !absentTeachers.some(at2 => at2.teacherId === t.uid) && // not absent
                                        !timetable.some(te => te.teacherId === t.uid && te.day === todayName && te.bell === entry.bell) // free at this bell
                                      );
                                      return {
                                        bell: entry.bell,
                                        class: `${level}${section}`,
                                        substituteId: freeTeacher?.uid || 'NONE',
                                        substituteName: freeTeacher?.name || 'FREE BELL'
                                      };
                                    })
                                  };
                               });

                               await setDoc(doc(db, 'arrangements', today), {
                                 date: today,
                                 absentTeachers: teacherList
                               });
                               alert("Arrangement Generated!");
                             }}
                             className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-black text-xs hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-xl shadow-indigo-200"
                           >
                             <Sparkles className="w-4 h-4" /> GENERATE FOR TODAY
                           </button>
                         </div>
                         <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {arrangements.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).flatMap(a => a.absentTeachers).map((at, idx) => (
                               <div key={idx} className="bg-white border-2 border-indigo-50 rounded-3xl p-6 shadow-sm overflow-hidden">
                                  <div className="flex items-center gap-4 mb-4 border-b pb-4">
                                     <div className="w-10 h-10 bg-red-50 text-red-500 rounded-full flex items-center justify-center"><UserX className="w-5 h-5"/></div>
                                     <h5 className="font-bold text-indigo-950">{at.teacherName}</h5>
                                  </div>
                                  <table className="w-full text-[10px]">
                                     <tbody>
                                       {at.substitutions.map((s, i) => (
                                         <tr key={i} className="border-b last:border-0">
                                            <td className="py-2 text-indigo-600 font-black">B{s.bell}</td>
                                            <td className="py-2 font-bold">{s.class}</td>
                                            <td className="py-2 font-black text-gray-700">{s.substituteName}</td>
                                         </tr>
                                       ))}
                                     </tbody>
                                  </table>
                               </div>
                            ))}
                            {arrangements.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).length === 0 && (
                              <div className="col-span-full py-20 text-center text-gray-400 italic">Today's arrangement not generated yet.</div>
                            )}
                         </div>
                       </Card>
                    </div>
                  )}

                  {activeArrangementTab === 'leaves' && (
                    <div className="grid md:grid-cols-2 gap-6">
                      {leaves.sort((a,b) => b.startDate.localeCompare(a.startDate)).map(l => (
                        <div key={l.id} className="bg-white p-8 rounded-[2rem] border-2 border-indigo-50 shadow-sm flex flex-col justify-between group hover:border-indigo-600 transition-all">
                          <div>
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <h5 className="text-xl font-black text-indigo-950">{l.teacherName}</h5>
                                <p className="text-xs font-bold text-indigo-400">{l.mobile}</p>
                              </div>
                              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${l.status === 'approved' ? 'bg-green-100 text-green-600' : l.status === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
                                {l.status}
                              </span>
                            </div>
                            <div className="bg-gray-50 p-4 rounded-2xl mb-4 border border-indigo-50/50">
                              <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Leave Duration</p>
                              <div className="flex items-center gap-3 text-sm font-bold text-gray-700">
                                <Calendar className="w-4 h-4 text-indigo-400" />
                                {format(parseISO(l.startDate), 'dd MMM')} to {format(parseISO(l.endDate), 'dd MMM yyyy')}
                              </div>
                            </div>
                            <p className="text-gray-600 text-xs leading-relaxed italic border-l-4 border-indigo-200 pl-4">{l.reason}</p>
                          </div>
                          
                          {l.status === 'pending' && (
                            <div className="flex gap-4 mt-8">
                              <button 
                                onClick={() => updateDoc(doc(db, 'leaves', l.id), { status: 'approved' })}
                                className="flex-1 bg-green-600 text-white py-3 rounded-2xl font-black text-[10px] tracking-widest hover:bg-green-700 shadow-lg shadow-green-600/20"
                              >APPROVE</button>
                               <button 
                                onClick={() => updateDoc(doc(db, 'leaves', l.id), { status: 'rejected' })}
                                className="flex-1 bg-red-600 text-white py-3 rounded-2xl font-black text-[10px] tracking-widest hover:bg-red-700 shadow-lg shadow-red-600/20"
                              >REJECT</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeAdminSection === 'teachers' && (
                <Card title="Teacher Repository" icon={Users}>
                  <div className="overflow-x-auto rounded-2xl border border-indigo-50">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="p-4 text-left font-black text-indigo-900">IDENTIFIER</th>
                          <th className="p-4 text-left font-black text-indigo-900">CONTACT</th>
                          <th className="p-4 text-left font-black text-indigo-900">ASSIGNMENTS</th>
                          <th className="p-4 text-left font-black text-indigo-900">ATTENDANCE (MO)</th>
                          <th className="p-4 text-center font-black text-indigo-900">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allTeachers.map(t => (
                          <tr key={t.uid} className="border-b last:border-0 hover:bg-indigo-50/20 transition-all">
                            <td className="p-4">
                              <p className="font-black text-gray-900 capitalize">{t.name}</p>
                              <p className="text-[10px] text-gray-400 font-mono tracking-tighter">{t.uid}</p>
                            </td>
                            <td className="p-4">
                              <p className="font-bold text-gray-700">{t.email}</p>
                              <p className="text-[10px] text-gray-400">{t.mobile}</p>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-wrap gap-1">
                                {t.classes.map(c => <span key={c} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md text-[8px] font-black">{c}</span>)}
                              </div>
                            </td>
                            <td className="p-4">
                              <span className="font-black text-indigo-600">{attendance.filter(a => a.teacherId === t.uid && format(new Date(a.date), 'MM') === format(new Date(), 'MM')).length} days</span>
                            </td>
                            <td className="p-4 text-center">
                              <button 
                                onClick={() => deleteDoc(doc(db, 'users', t.uid))}
                                className="w-8 h-8 rounded-lg bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all mx-auto flex items-center justify-center border border-red-100"
                              ><Trash2 className="w-4 h-4"/></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {activeAdminSection === 'timetable' && <TimetableSection />}
            </motion.div>
          )}

          {view === 'teacherPortal' && userProfile?.role === 'teacher' && (
            <motion.div key="teacher" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
               {/* Arrangement Notification */}
               {arrangements.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).flatMap(a => a.absentTeachers).flatMap(at => at.substitutions).filter(s => s.substituteId === user.uid).length > 0 && (
                 <div className="bg-gradient-to-r from-orange-600 to-red-600 p-8 rounded-[2.5rem] text-white shadow-2xl shadow-orange-200 relative overflow-hidden">
                   <div className="relative z-10">
                     <div className="flex items-center gap-4 mb-4">
                       <AlertCircle className="w-10 h-10 animate-pulse text-white" />
                       <h3 className="text-3xl font-black italic tracking-tighter">URGENT: ARRANGEMENT ASSIGNED</h3>
                     </div>
                     <p className="text-lg font-bold opacity-90 mb-6">You have been assigned substitutions for today. Please check the schedule below:</p>
                     <div className="flex flex-wrap gap-4">
                        {arrangements.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).flatMap(a => a.absentTeachers).flatMap(at => at.substitutions).filter(s => s.substituteId === user.uid).map((s, idx) => (
                          <div key={idx} className="bg-white/20 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/30">
                            <span className="block text-[10px] font-black uppercase opacity-70">Bell {s.bell}</span>
                            <span className="text-xl font-bold">Class {s.class}</span>
                          </div>
                        ))}
                     </div>
                   </div>
                   <Sparkles className="absolute -right-10 -bottom-10 w-48 h-48 opacity-20 rotate-12" />
                 </div>
               )}

               {/* Simplified Teacher View */}
               <div className="grid md:grid-cols-2 gap-8">
                  <Card title="Attendance Check-In" icon={CalendarCheck}>
                     {!attendance.some(a => a.teacherId === user.uid && a.date === format(new Date(), 'yyyy-MM-dd')) ? (
                       <div className="text-center py-6">
                          <p className="text-gray-400 text-sm mb-6">Enter code provided by Admin to mark present.</p>
                          <input 
                            id="att-code" type="text" placeholder="CODE" 
                            className="w-full p-4 bg-gray-50 border rounded-2xl text-center text-2xl font-black mb-4 focus:border-indigo-600 outline-none transition-all uppercase"
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
                            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-indigo-200"
                          >MARK PRESENT</button>
                       </div>
                     ) : (
                       <div className="text-center py-10">
                          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                          <h4 className="text-2xl font-black text-indigo-950">PRESENT TODAY</h4>
                          <p className="text-gray-400 text-xs font-bold uppercase mt-1 tracking-widest">{format(new Date(), 'dd MMMM yyyy')}</p>
                       </div>
                     )}
                  </Card>

                  <Card title="Apply for Leave" icon={FileText}>
                    {/* Simplified Leave Form */}
                    <div className="space-y-4">
                       <div className="grid grid-cols-2 gap-4">
                         <input type="date" id="l-start" className="p-3 bg-gray-50 border rounded-xl text-xs outline-none focus:border-indigo-600 transition-all"/>
                         <input type="date" id="l-end" className="p-3 bg-gray-50 border rounded-xl text-xs outline-none focus:border-indigo-600 transition-all"/>
                       </div>
                       <textarea id="l-reason" placeholder="Reason for leave..." className="w-full p-4 bg-gray-50 border rounded-2xl text-xs h-24 outline-none focus:border-indigo-600 transition-all"></textarea>
                       <button 
                        onClick={async () => {
                          const start = (document.getElementById('l-start') as HTMLInputElement).value;
                          const end = (document.getElementById('l-end') as HTMLInputElement).value;
                          const reason = (document.getElementById('l-reason') as HTMLInputElement).value;
                          if (start && end && reason) {
                            await addDoc(collection(db, 'leaves'), {
                              teacherId: user.uid,
                              teacherName: userProfile.name,
                              mobile: userProfile.mobile,
                              startDate: start,
                              endDate: end,
                              reason,
                              status: 'pending'
                            });
                            alert("Request Sent!");
                            (document.getElementById('l-reason') as HTMLTextAreaElement).value = '';
                          }
                        }}
                        className="w-full bg-indigo-100 text-indigo-600 py-4 rounded-2xl font-black text-xs hover:bg-indigo-600 hover:text-white transition-all uppercase tracking-widest"
                       >REQUEST APPROVAL</button>
                    </div>
                  </Card>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
