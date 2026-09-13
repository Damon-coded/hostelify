/*******************************************************
 * HOSTELIFY BACKEND
 * Google Apps Script - code.gs
 *******************************************************/

/* =====================================================
 * CONFIGURATION
 * ===================================================== */
const CONFIG = {
  SPREADSHEET_ID: '1S9e5zmZAdu0CVQaB4jfmej5o4VVI2K_qUfeIW0sWMZI',

  SHEETS: {
    STUDENTS: 'Students',
    HOSTELS: 'Hostels',
    ROOMS: 'Rooms',
    SETTINGS: 'Settings',
    NCR_PINCODES: 'NCR_Pincodes',
    PIN_COORDINATES: 'PIN_Coordinates',
    STATE_ZONES: 'State_Zones'   // <-- naya
  },

  STATUS: {
    REGISTERED: 'Registered',
    ALLOCATED: 'Allocated',
    NOT_ALLOCATED: 'Not Allocated'
  },

  REGION: {
    NCR: 'NCR',
    OUTSIDE_NCR: 'Outside NCR'
  },

  SOFT_SCORES: {
    HOSTEL_PREFERENCE: 3,
    SAME_YEAR: 2,
    SAME_COURSE: 2
  }
};

/* =====================================================
 * BASIC SHEET HELPERS
 * ===================================================== */
function getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);
  return sheet;
}

function getSettings(sheet) {
  const data = sheet.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const value = data[i][1];
    if (key) settings[key] = value;
  }
  return settings;
}

function updateSetting(sheet, key, value) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return true;
    }
  }
  throw new Error('Setting key not found: ' + key);
}

/* =====================================================
 * PWD (PERSON WITH DISABILITY) HELPERS
 * ===================================================== */

// Reads any "yes-ish" value (Yes / yes / TRUE / Y) as true.
// Used for the student's own pwd flag and a room's pwdOnly flag,
// and (below) as the shared source of truth for profile validation.
function isPwdYes(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'yes' || v === 'y' || v === 'true';
}

// Is this an explicit "no" (as opposed to blank/invalid)?
function isPwdNo(value) {
  return String(value || '').trim().toLowerCase() === 'no';
}

// Normalizes any accepted PWD input into the canonical "Yes"/"No"
// string that gets written to the sheet.
function normalizePwd(value) {
  return isPwdYes(value) ? 'Yes' : 'No';
}

/* =====================================================
 * VALIDATION
 * ===================================================== */

// Registration requires ONLY studentId + password.
// Remaining info is collected later via completeStudentProfile().
function validateStudent(student) {
  const requiredFields = ['studentId', 'password'];
  for (let i = 0; i < requiredFields.length; i++) {
    const field = requiredFields[i];
    if (student[field] === undefined || student[field] === null || String(student[field]).trim() === '') {
      throw new Error(field + ' is required.');
    }
  }
  if (String(student.password).trim().length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }
}

// Validation for the MAIN PORTAL form.
function validateStudentProfile(profile) {
  const requiredFields = ['name', 'email', 'course', 'gender', 'pwd', 'year', 'hostelPreference', 'housePincode', 'state'];
  for (let i = 0; i < requiredFields.length; i++) {
    const field = requiredFields[i];
    if (profile[field] === undefined || profile[field] === null || String(profile[field]).trim() === '') {
      throw new Error(field + ' is required.');
    }
  }

  const emailPattern = /^[^\s@]+@[^\s@]+.[^\s@]+$/;
  if (!emailPattern.test(String(profile.email).trim())) {
    throw new Error('Invalid email address.');
  }

  // PWD (person with disability) must be an explicit Yes/No.
  if (!isPwdYes(profile.pwd) && !isPwdNo(profile.pwd)) {
    throw new Error('pwd must be either "Yes" or "No".');
  }

  validatePincode(profile.housePincode);
}

// Backend source of truth for whether the hostel/profile form has
// been submitted. We intentionally do NOT depend on frontend state.
function isStudentProfileComplete(student) {
  if (!student) return false;
  const requiredFields = ['name', 'email', 'course', 'gender', 'pwd', 'year', 'hostelPreference', 'housePincode', 'state'];
  for (let i = 0; i < requiredFields.length; i++) {
    const value = student[requiredFields[i]];
    if (value === undefined || value === null || String(value).trim() === '') return false;
  }
  return true;
}

/* =====================================================
 * STUDENT ID
 * ===================================================== */
function isStudentIdExists(studentId) {
  const sheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const studentIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < studentIds.length; i++) {
    if (String(studentIds[i][0]).trim() === String(studentId).trim()) return true;
  }
  return false;
}

/* =====================================================
 * PIN CODE / REGION
 * ===================================================== */
function validatePincode(pincode) {
  const pin = String(pincode).trim();
  const pinPattern = /^\d{6}$/;
  if (!pinPattern.test(pin)) throw new Error('PIN code must contain exactly 6 digits.');
  return pin;
}

function determineRegion(pincode) {
  const pin = validatePincode(pincode);
  const sheet = getSheet(CONFIG.SHEETS.NCR_PINCODES);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const sheetPincode = String(data[i][0]).trim();
    const region = String(data[i][1]).trim();
    if (sheetPincode === pin) {
      return region === CONFIG.REGION.NCR ? CONFIG.REGION.NCR : CONFIG.REGION.OUTSIDE_NCR;
    }
  }
  // If PIN is not present in NCR mapping, treat it as outside NCR.
  return CONFIG.REGION.OUTSIDE_NCR;
}

/* =====================================================
 * PIN COORDINATES / DISTANCE
 * ===================================================== */
function getCoordinatesByPincode(pincode) {
  const pin = validatePincode(pincode);
  const sheet = getSheet(CONFIG.SHEETS.PIN_COORDINATES);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const sheetPincode = String(data[i][0]).trim();
    if (sheetPincode === pin) {
      const lat = Number(data[i][1]);
      const lon = Number(data[i][2]);
      if (isNaN(lat) || isNaN(lon)) throw new Error('Invalid coordinates stored for PIN: ' + pin);
      return { latitude: lat, longitude: lon };
    }
  }
  throw new Error('Coordinates not found for PIN code: ' + pin);
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (degrees) => degrees * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

function calculateStudentDistance(student) {
  // Only NCR students need distance.
  if (student.region !== CONFIG.REGION.NCR) return '';

  const homeCoords = getCoordinatesByPincode(student.housePincode);
  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);
  const settings = getSettings(settingsSheet);

  const campusLat = Number(settings.campusLatitude);
  const campusLon = Number(settings.campusLongitude);
  if (isNaN(campusLat) || isNaN(campusLon)) {
    throw new Error('Campus coordinates are missing or invalid in Settings sheet.');
  }

  return calculateHaversineDistance(homeCoords.latitude, homeCoords.longitude, campusLat, campusLon);
}

/* =====================================================
 * REGISTRATION
 * ===================================================== */
function registerStudent(student) {
  // Only studentId + password are accepted here.
  validateStudent(student);

  if (isStudentIdExists(student.studentId)) {
    throw new Error('Student ID already registered.');
  }

  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);
  const settings = getSettings(settingsSheet);
  const batchId = settings.currentBatchId;
  if (!batchId) throw new Error('Current batch ID is not configured.');

  const hashedPassword = hashPassword(student.password);
  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);

  /* Students sheet structure:
   * 1 studentid, 2 name, 3 email, 4 course, 5 gender, 6 year,
   * 7 hostelPreference, 8 housePincode, 9 state, 10 region,
   * 11 campusDistanceKm, 12 applicationStatus, 13 allocatedHostelId,
   * 14 allocatedRoomId, 15 allocationScore, 16 batchId, 17 password,
   * 18 pwd <- add a "pwd" header as the LAST column. Left blank at
   * registration; filled in ("Yes"/"No") on hostel form completion.
   * Profile fields stay blank until the main portal form.
   */
  studentsSheet.appendRow([
    String(student.studentId).trim(), '', '', '', '', '', '', '', '', '', '',
    CONFIG.STATUS.REGISTERED, '', '', '', batchId, hashedPassword, ''
  ]);

  return {
    success: true,
    message: 'Account created successfully. Complete your profile after signing in.',
    studentId: String(student.studentId).trim(),
    batchId: batchId,
    status: CONFIG.STATUS.REGISTERED,
    profileComplete: false,
    alreadySubmitted: false
  };
}

/* =====================================================
 * FIND STUDENT
 * ===================================================== */
function findStudentRow(studentId) {
  const targetStudentId = String(studentId || '').trim();
  if (!targetStudentId) throw new Error('Student ID is required.');

  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const data = studentsSheet.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0];
  const studentIdCol = headers.indexOf('studentid');
  if (studentIdCol === -1) throw new Error('studentid column not found in Students sheet.');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][studentIdCol]).trim() === targetStudentId) {
      const student = {};
      for (let j = 0; j < headers.length; j++) student[headers[j]] = data[i][j];
      student._rowNumber = i + 1;
      return { sheet: studentsSheet, headers: headers, student: student };
    }
  }
  return null;
}

/* =====================================================
 * GET STUDENT PROFILE
 * ===================================================== */
function getStudentProfile(studentId) {
  const found = findStudentRow(studentId);
  if (!found) throw new Error('Student not found.');

  const s = found.student;
  const profileComplete = isStudentProfileComplete(s);

  return {
    success: true,
    studentId: String(s.studentid || ''),
    name: String(s.name || ''),
    email: String(s.email || ''),
    course: String(s.course || ''),
    gender: String(s.gender || ''),
    pwd: String(s.pwd || ''),
    year: String(s.year || ''),
    hostelPreference: String(s.hostelPreference || ''),
    housePincode: String(s.housePincode || ''),
    state: String(s.state || ''),
    region: String(s.region || ''),
    campusDistanceKm: s.campusDistanceKm || '',
    status: String(s.applicationStatus || CONFIG.STATUS.REGISTERED),
    // Used by student.js to decide whether to show the
    // "already submitted" announcement.
    profileComplete: profileComplete,
    alreadySubmitted: profileComplete
  };
}

/* =====================================================
 * COMPLETE STUDENT PROFILE
 * ===================================================== */
function completeStudentProfile(profile) {
  if (!profile || !profile.studentId) throw new Error('Student ID is required.');

  // Validate the profile before touching the Google Sheet.
  validateStudentProfile(profile);

  const found = findStudentRow(profile.studentId);
  if (!found) throw new Error('Student not found.');

  /* ONE-TIME SUBMISSION LOCK
   * If all profile fields are already present, the student has
   * already submitted the hostel form. DO NOT overwrite existing data.
   */
  if (isStudentProfileComplete(found.student)) {
    return {
      success: true,
      alreadySubmitted: true,
      profileComplete: true,
      message: 'Your hostel form has already been submitted and is locked.',
      studentId: String(profile.studentId).trim(),
      region: String(found.student.region || ''),
      campusDistanceKm: found.student.campusDistanceKm || '',
      status: String(found.student.applicationStatus || CONFIG.STATUS.REGISTERED)
    };
  }

  if (isFormSubmissionLocked()) {
    throw new Error('Hostel form submissions are currently locked by the admin. Please check back later.');
  }

  const region = determineRegion(profile.housePincode);
  const campusDistanceKm = calculateStudentDistance({
    region: region,
    housePincode: String(profile.housePincode).trim()
  });

  // Values that will be written to the existing Students sheet.
  const map = {
    name: String(profile.name).trim(),
    email: String(profile.email).trim(),
    course: String(profile.course).trim(),
    gender: String(profile.gender).trim(),
    pwd: normalizePwd(profile.pwd),
    year: String(profile.year).trim(),
    hostelPreference: String(profile.hostelPreference).trim(),
    housePincode: String(profile.housePincode).trim(),
    state: String(profile.state).trim(),
    region: region,
    campusDistanceKm: campusDistanceKm,
    applicationStatus: CONFIG.STATUS.REGISTERED
  };

  const row = found._rowNumber || found.student._rowNumber;

  // Write only the intended profile columns.
  Object.keys(map).forEach(function (key) {
    const col = found.headers.indexOf(key);
    if (col === -1) throw new Error('Column not found in Students sheet: ' + key);
    found.sheet.getRange(row, col + 1).setValue(map[key]);
  });

  // Make absolutely sure the sheet has finished the write before returning.
  SpreadsheetApp.flush();

  return {
    success: true,
    alreadySubmitted: false,
    profileComplete: true,
    message: 'Hostel form submitted successfully. The form is now locked.',
    studentId: String(profile.studentId).trim(),
    region: region,
    campusDistanceKm: campusDistanceKm,
    status: CONFIG.STATUS.REGISTERED
  };
}

/* =====================================================
 * EDIT STUDENT PROFILE
 * ===================================================== */
function editStudentProfile(profile) {
  if (!profile || !profile.studentId) throw new Error('Student ID is required.');

  const found = findStudentRow(profile.studentId);
  if (!found) throw new Error('Student not found.');

  const currentStatus = String(found.student.applicationStatus || CONFIG.STATUS.REGISTERED).trim();
  if (currentStatus !== CONFIG.STATUS.REGISTERED) {
    throw new Error('Editing is no longer possible: your allocation has already been processed.');
  }

  if (isFormEditLocked()) {
    throw new Error('Editing hostel forms is currently locked by the admin.');
  }

  validateStudentProfile(profile);

  const region = determineRegion(profile.housePincode);
  const campusDistanceKm = calculateStudentDistance({
    region: region,
    housePincode: String(profile.housePincode).trim()
  });

  const map = {
    name: String(profile.name).trim(),
    email: String(profile.email).trim(),
    course: String(profile.course).trim(),
    gender: String(profile.gender).trim(),
    pwd: normalizePwd(profile.pwd),
    year: String(profile.year).trim(),
    hostelPreference: String(profile.hostelPreference).trim(),
    housePincode: String(profile.housePincode).trim(),
    state: String(profile.state).trim(),
    region: region,
    campusDistanceKm: campusDistanceKm,
    applicationStatus: CONFIG.STATUS.REGISTERED
  };

  const row = found._rowNumber || found.student._rowNumber;

  Object.keys(map).forEach(function (key) {
    const col = found.headers.indexOf(key);
    if (col === -1) throw new Error('Column not found in Students sheet: ' + key);
    found.sheet.getRange(row, col + 1).setValue(map[key]);
  });

  SpreadsheetApp.flush();

  return {
    success: true,
    alreadySubmitted: false,
    profileComplete: true,
    message: 'Hostel form updated successfully.',
    studentId: String(profile.studentId).trim(),
    region: region,
    campusDistanceKm: campusDistanceKm,
    status: CONFIG.STATUS.REGISTERED
  };
}

/* =====================================================
 * CANCEL REGISTRATION (clear form, keep account)
 * ===================================================== */
function cancelRegistration(studentId) {
  if (!studentId || String(studentId).trim() === '') throw new Error('Student ID is required.');

  const found = findStudentRow(studentId);
  if (!found) throw new Error('Student not found.');

  const currentStatus = String(found.student.applicationStatus || CONFIG.STATUS.REGISTERED).trim();
  if (currentStatus !== CONFIG.STATUS.REGISTERED) {
    throw new Error('Cancellation is no longer possible: your allocation has already been processed. Please contact the admin.');
  }

  const row = found._rowNumber || found.student._rowNumber;

  // Clear ONLY the hostel-form fields. studentId, password, and
  // batchId are left as-is, so the account stays active.
  // applicationStatus is explicitly kept at 'Registered'.
  const clearMap = {
    name: '', email: '', course: '', gender: '', pwd: '', year: '',
    hostelPreference: '', housePincode: '', state: '', region: '',
    campusDistanceKm: '', applicationStatus: CONFIG.STATUS.REGISTERED
  };

  Object.keys(clearMap).forEach(function (key) {
    const col = found.headers.indexOf(key);
    if (col === -1) throw new Error('Column not found in Students sheet: ' + key);
    found.sheet.getRange(row, col + 1).setValue(clearMap[key]);
  });

  SpreadsheetApp.flush();

  return {
    success: true,
    message: 'Your hostel form has been cancelled. Your account is still active — log in again to fill the form.',
    status: CONFIG.STATUS.REGISTERED
  };
}

/* =====================================================
 * PASSWORD HASHING
 * ===================================================== */
function hashPassword(password) {
  if (!password || String(password).trim() === '') throw new Error('Password is required.');

  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password).trim());
  let hashString = '';
  for (let i = 0; i < rawHash.length; i++) {
    let byte = rawHash[i];
    if (byte < 0) byte += 256;
    const hex = byte.toString(16);
    hashString += hex.length === 1 ? '0' + hex : hex;
  }
  return hashString;
}

/* =====================================================
 * LOGIN
 * ===================================================== */
function loginStudent(studentId, password) {
  if (!studentId || String(studentId).trim() === '') throw new Error('Student ID is required.');
  if (!password || String(password).trim() === '') throw new Error('Password is required.');

  const targetStudentId = String(studentId).trim();
  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const data = studentsSheet.getDataRange().getValues();

  if (data.length < 2) return { success: false, message: 'Invalid Student ID or password.' };

  const headers = data[0];
  const studentIdCol = headers.indexOf('studentid');
  const passwordCol = headers.indexOf('password');
  const nameCol = headers.indexOf('name');
  const statusCol = headers.indexOf('applicationStatus');

  if (studentIdCol === -1 || passwordCol === -1) {
    throw new Error('Required columns (studentid, password) not found in Students sheet.');
  }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowStudentId = String(row[studentIdCol]).trim();
    if (rowStudentId !== targetStudentId) continue;

    const storedHash = String(row[passwordCol] || '');
    const providedHash = hashPassword(password);
    if (storedHash !== providedHash) return { success: false, message: 'Invalid Student ID or password.' };

    const profile = {
      name: row[nameCol],
      email: row[headers.indexOf('email')],
      course: row[headers.indexOf('course')],
      gender: row[headers.indexOf('gender')],
      pwd: row[headers.indexOf('pwd')],
      year: row[headers.indexOf('year')],
      hostelPreference: row[headers.indexOf('hostelPreference')],
      housePincode: row[headers.indexOf('housePincode')],
      state: row[headers.indexOf('state')]
    };

    const complete = isStudentProfileComplete(profile);

    return {
      success: true,
      message: 'Login successful.',
      studentId: rowStudentId,
      name: row[nameCol] || 'Student',
      status: row[statusCol] || CONFIG.STATUS.REGISTERED,
      profileComplete: complete,
      alreadySubmitted: complete
    };
  }

  return { success: false, message: 'Invalid Student ID or password.' };
}

/* =====================================================
 * BATCH
 * ===================================================== */
function getCurrentBatchId() {
  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);
  const settings = getSettings(settingsSheet);
  const batchId = settings.currentBatchId;
  if (!batchId || String(batchId).trim() === '') {
    throw new Error('Current batch ID is not configured in Settings.');
  }
  return String(batchId).trim();
}

function getStudentsByBatch(batchId) {
  if (!batchId || String(batchId).trim() === '') throw new Error('Batch ID is required.');
  const targetBatchId = String(batchId).trim();

  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const data = studentsSheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const batchIdCol = headers.indexOf('batchId');
  if (batchIdCol === -1) throw new Error('batchId column not found in Students sheet.');

  const matchingStudents = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[batchIdCol]).trim() === targetBatchId) {
      const student = {};
      for (let j = 0; j < headers.length; j++) student[headers[j]] = row[j];
      student._rowNumber = i + 1;
      matchingStudents.push(student);
    }
  }
  return matchingStudents;
}

/* =====================================================
 * ALLOCATION SORTING
 * ===================================================== */
function sortStudentsForAllocation(students) {
  const sorted = students.slice();

  sorted.sort(function (a, b) {
    // PWD students get absolute top priority, ahead of everything else.
    const pwdA = isPwdYes(a.pwd) ? 0 : 1;
    const pwdB = isPwdYes(b.pwd) ? 0 : 1;
    if (pwdA !== pwdB) return pwdA - pwdB;

    const regionA = String(a.region || '').trim();
    const regionB = String(b.region || '').trim();

    // Outside NCR has higher priority.
    const outsideA = regionA === CONFIG.REGION.OUTSIDE_NCR ? 0 : 1;
    const outsideB = regionB === CONFIG.REGION.OUTSIDE_NCR ? 0 : 1;
    if (outsideA !== outsideB) return outsideA - outsideB;

    // For NCR students, priority order is REVERSED: larger campus
    // distance gets priority; smaller distance is placed later.
    // if (regionA === CONFIG.REGION.NCR) {
    //   const distanceA = Number(a.campusDistanceKm);
    //   const distanceB = Number(b.campusDistanceKm);
    //   const safeA = isNaN(distanceA) ? Number.MAX_SAFE_INTEGER : distanceA;
    //   const safeB = isNaN(distanceB) ? Number.MAX_SAFE_INTEGER : distanceB;
    //   if (safeA !== safeB) return safeB - safeA;
    // }
    
    if (regionA === CONFIG.REGION.NCR) {
      // ... existing NCR distance-based sort (jaisa hai waisa rehne do)
      const distanceA = Number(a.campusDistanceKm);
      const distanceB = Number(b.campusDistanceKm);
      const safeA = isNaN(distanceA) ? Number.MAX_SAFE_INTEGER : distanceA;
      const safeB = isNaN(distanceB) ? Number.MAX_SAFE_INTEGER : distanceB;
      if (safeA !== safeB) return safeB - safeA;
    } else if (regionA === CONFIG.REGION.OUTSIDE_NCR) {
      // NAYA: zone-based secondary priority
      const zoneA = getStateZone(a.state);
      const zoneB = getStateZone(b.state);
      if (zoneA !== zoneB) return zoneA - zoneB;   // lower zone number = farther = pehle
    }

    // Deterministic final tie-breaker (same zone ke andar) — waisa hi rahega
    return String(a.studentid || '').localeCompare(String(b.studentid || ''));

    // Deterministic final tie-breaker.
    return String(a.studentid || '').localeCompare(String(b.studentid || ''));
  });

  return sorted;
}

// NEWELY ADDED:
/* =====================================================
 * STATE ZONE (secondary priority for Outside-NCR students)
 * ===================================================== */
let _stateZoneCache = null;

function getStateZoneMap() {
  if (_stateZoneCache) return _stateZoneCache;
  const sheet = getSheet(CONFIG.SHEETS.STATE_ZONES);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const state = String(data[i][0]).trim().toLowerCase();
    const zone = Number(data[i][1]);
    if (state && !isNaN(zone)) map[state] = zone;
  }
  _stateZoneCache = map;
  return map;
}

// Unmapped state -> lowest priority (max zone + 1), taaki koi
// bhi galti se top priority na le le agar sheet mein state missing ho.
function getStateZone(state) {
  const map = getStateZoneMap();
  const key = String(state || '').trim().toLowerCase();
  if (map.hasOwnProperty(key)) return map[key];

  const zones = Object.values(map);
  const maxZone = zones.length ? Math.max.apply(null, zones) : 0;
  return maxZone + 1;
}





/* Returns the priority-ordered list of students for a batch who are
 * still WAITING on a room — status 'Registered' or 'Not Allocated'.
 * Already-'Allocated' students are excluded from this queue view.
 * ===================================================== */
function getPriorityList(batchId, adminKey) {
  verifyAdminAccess(adminKey);
  if (!batchId || String(batchId).trim() === '') throw new Error('Batch ID is required to get priority list.');

  const targetBatchId = String(batchId).trim();
  const allStudents = getStudentsByBatch(targetBatchId);

  const students = allStudents.filter(function (s) {
    return String(s.applicationStatus || CONFIG.STATUS.REGISTERED).trim() !== CONFIG.STATUS.ALLOCATED;
  });

  const sortedStudents = sortStudentsForAllocation(students);

  const list = sortedStudents.map(function (s, index) {
    return {
      rank: index + 1,
      studentId: String(s.studentid || ''),
      name: String(s.name || ''),
      course: String(s.course || ''),
      year: String(s.year || ''),
      gender: String(s.gender || ''),
      pwd: String(s.pwd || 'No'),
      hostelPreference: String(s.hostelPreference || ''),
      region: String(s.region || ''),
      state: String(s.state || ''), 
      zone: String(s.region || '').trim() === CONFIG.REGION.OUTSIDE_NCR ? getStateZone(s.state) : '',
      campusDistanceKm: (s.campusDistanceKm === '' || s.campusDistanceKm == null) ? '' : Number(s.campusDistanceKm),
      status: String(s.applicationStatus || CONFIG.STATUS.REGISTERED),
      allocatedHostelId: String(s.allocatedHostelId || ''),
      allocatedRoomId: String(s.allocatedRoomId || ''),
      allocationScore: (s.allocationScore === '' || s.allocationScore == null) ? '' : Number(s.allocationScore)
    };
  });

  return { success: true, batchId: targetBatchId, count: list.length, students: list };
}

function getAllStudentsList(batchId, adminKey) {
  verifyAdminAccess(adminKey);
  if (!batchId || String(batchId).trim() === '') throw new Error('Batch ID is required to get all students.');

  const targetBatchId = String(batchId).trim();
  const students = getStudentsByBatch(targetBatchId);

  // Only students who have actually filled the hostel form.
  const submitted = students.filter(function (s) { return isStudentProfileComplete(s); });

  // Plain deterministic order — just by studentId, no priority logic.
  submitted.sort(function (a, b) { return String(a.studentid || '').localeCompare(String(b.studentid || '')); });

  const list = submitted.map(function (s) {
    return {
      studentId: String(s.studentid || ''),
      name: String(s.name || ''),
      course: String(s.course || ''),
      year: String(s.year || ''),
      gender: String(s.gender || ''),
      pwd: String(s.pwd || 'No'),
      hostelPreference: String(s.hostelPreference || ''),
      region: String(s.region || ''),
      state: String(s.state || ''),
      campusDistanceKm: (s.campusDistanceKm === '' || s.campusDistanceKm == null) ? '' : Number(s.campusDistanceKm),
      status: String(s.applicationStatus || CONFIG.STATUS.REGISTERED),
      allocatedHostelId: String(s.allocatedHostelId || ''),
      allocatedRoomId: String(s.allocatedRoomId || ''),
      allocationScore: (s.allocationScore === '' || s.allocationScore == null) ? '' : Number(s.allocationScore)
    };
  });

  return { success: true, batchId: targetBatchId, count: list.length, students: list };
}

/* =====================================================
 * GET STUDENT PRIORITY
 * ===================================================== */
function getStudentPriority(studentId) {
  if (!studentId || String(studentId).trim() === '') throw new Error('Student ID is required.');
  const targetStudentId = String(studentId).trim();

  const found = findStudentRow(targetStudentId);
  if (!found) throw new Error('Student not found.');

  const student = found.student;
  const batchId = String(student.batchId || '').trim();

  if (!batchId) {
    return {
      success: true, studentId: targetStudentId, priorityRank: null, totalInBatch: 0,
      status: String(student.applicationStatus || CONFIG.STATUS.REGISTERED)
    };
  }

  const currentStatus = String(student.applicationStatus || CONFIG.STATUS.REGISTERED).trim();

  // Once a student has been allocated, they leave the live priority
  // queue. priorityRank comes back null; frontend renders it as "-".
  if (currentStatus === CONFIG.STATUS.ALLOCATED) {
    return { success: true, studentId: targetStudentId, priorityRank: null, totalInBatch: 0, status: currentStatus };
  }

  const batchStudents = getStudentsByBatch(batchId);

  // Rank only among students still waiting (Registered or Not
  // Allocated) — the same pool the admin's priority list uses.
  const waitingStudents = batchStudents.filter(function (s) {
    return String(s.applicationStatus || CONFIG.STATUS.REGISTERED).trim() !== CONFIG.STATUS.ALLOCATED;
  });

  const sortedStudents = sortStudentsForAllocation(waitingStudents);

  let rank = null;
  for (let i = 0; i < sortedStudents.length; i++) {
    if (String(sortedStudents[i].studentid || '').trim() === targetStudentId) {
      rank = i + 1;
      break;
    }
  }

  return { success: true, studentId: targetStudentId, priorityRank: rank, totalInBatch: sortedStudents.length, status: currentStatus };
}

/* =====================================================
 * HOSTEL / ROOM HELPERS
 * ===================================================== */
function getAllHostels() {
  const hostelsSheet = getSheet(CONFIG.SHEETS.HOSTELS);
  const data = hostelsSheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const hostels = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const hostel = {};
    for (let j = 0; j < headers.length; j++) hostel[headers[j]] = row[j];
    hostels.push(hostel);
  }
  return hostels;
}

/* =====================================================
 * GET OCCUPANCY STATS
 * ===================================================== */
function getOccupancyStats(adminKey) {
  verifyAdminAccess(adminKey);

  const hostels = getAllHostels();
  const roomsSheet = getSheet(CONFIG.SHEETS.ROOMS);
  const roomsData = roomsSheet.getDataRange().getValues();

  // Build a live occupant lookup: "hostelId|roomId" -> {studentId, name}
  const occupantMap = {};
  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const studentsData = studentsSheet.getDataRange().getValues();

  if (studentsData.length >= 2) {
    const sHeaders = studentsData[0];
    const sIdCol = sHeaders.indexOf('studentid');
    const nameCol = sHeaders.indexOf('name');
    const allocHostelCol = sHeaders.indexOf('allocatedHostelId');
    const allocRoomCol = sHeaders.indexOf('allocatedRoomId');

    if (sIdCol !== -1 && allocHostelCol !== -1 && allocRoomCol !== -1) {
      for (let i = 1; i < studentsData.length; i++) {
        const row = studentsData[i];
        const hId = String(row[allocHostelCol] || '').trim();
        const rId = String(row[allocRoomCol] || '').trim();
        if (hId && rId) {
          occupantMap[hId + '|' + rId] = {
            studentId: String(row[sIdCol] || ''),
            name: nameCol !== -1 ? String(row[nameCol] || '') : ''
          };
        }
      }
    }
  }

  if (roomsData.length < 2) {
    return {
      success: true,
      hostels: hostels.map(function (h) {
        return {
          hostelId: String(h.hostelId || ''), hostelName: String(h.hostelName || h.name || ''),
          gender: String(h.gender || ''), totalRooms: 0, occupied: 0, available: 0, other: 0,
          occupancyPercent: 0, rooms: []
        };
      }),
      totals: { totalRooms: 0, occupied: 0, available: 0, other: 0, occupancyPercent: 0 }
    };
  }

  const headers = roomsData[0];
  const hostelIdCol = headers.indexOf('hostelId');
  const roomIdCol = headers.indexOf('roomId');
  const statusCol = headers.indexOf('status');

  // Optional column: -1 if the admin hasn't added "pwdOnly" yet,
  // in which case every room is treated as not reserved.
  const pwdOnlyCol = headers.indexOf('pwdOnly');

  if (hostelIdCol === -1 || roomIdCol === -1 || statusCol === -1) {
    throw new Error('Required columns (hostelId, roomId, status) not found in Rooms sheet.');
  }

  // Group individual rooms under their hostel.
  const roomsByHostel = {};
  for (let i = 1; i < roomsData.length; i++) {
    const row = roomsData[i];
    const hId = String(row[hostelIdCol]).trim();
    const rId = String(row[roomIdCol]).trim();
    const status = String(row[statusCol]).trim();
    const reservedForPwd = pwdOnlyCol !== -1 && isPwdYes(row[pwdOnlyCol]);

    if (!roomsByHostel[hId]) roomsByHostel[hId] = [];
    const occupant = occupantMap[hId + '|' + rId];

    roomsByHostel[hId].push({
      roomId: rId, status: status || 'Unknown',
      occupantStudentId: occupant ? occupant.studentId : '',
      occupantName: occupant ? occupant.name : '',
      reservedForPwd: reservedForPwd
    });
  }

  function summarizeRooms(rooms) {
    let occupied = 0, available = 0, other = 0;
    rooms.forEach(function (r) {
      const s = r.status.toLowerCase();
      if (s === 'occupied') occupied++;
      else if (s === 'available') available++;
      else other++;
    });
    return { occupied: occupied, available: available, other: other };
  }

  function sortRooms(rooms) {
    return rooms.slice().sort(function (a, b) {
      return String(a.roomId).localeCompare(String(b.roomId), undefined, { numeric: true });
    });
  }

  let grandTotal = 0, grandOccupied = 0, grandAvailable = 0, grandOther = 0;
  const seenHostelIds = {};

  const hostelStats = hostels.map(function (h) {
    const hId = String(h.hostelId || '').trim();
    seenHostelIds[hId] = true;

    const rooms = sortRooms(roomsByHostel[hId] || []);
    const summary = summarizeRooms(rooms);

    grandTotal += rooms.length;
    grandOccupied += summary.occupied;
    grandAvailable += summary.available;
    grandOther += summary.other;

    const occupancyPercent = rooms.length > 0 ? Math.round((summary.occupied / rooms.length) * 1000) / 10 : 0;

    return {
      hostelId: hId, hostelName: String(h.hostelName || h.name || ''), gender: String(h.gender || ''),
      totalRooms: rooms.length, occupied: summary.occupied, available: summary.available,
      other: summary.other, occupancyPercent: occupancyPercent, rooms: rooms
    };
  });

  // Safety net: include any hostelId present in Rooms but missing from Hostels.
  Object.keys(roomsByHostel).forEach(function (hId) {
    if (seenHostelIds[hId]) return;

    const rooms = sortRooms(roomsByHostel[hId]);
    const summary = summarizeRooms(rooms);

    grandTotal += rooms.length;
    grandOccupied += summary.occupied;
    grandAvailable += summary.available;
    grandOther += summary.other;

    const occupancyPercent = rooms.length > 0 ? Math.round((summary.occupied / rooms.length) * 1000) / 10 : 0;

    hostelStats.push({
      hostelId: hId, hostelName: '', gender: '', totalRooms: rooms.length, occupied: summary.occupied,
      available: summary.available, other: summary.other, occupancyPercent: occupancyPercent, rooms: rooms
    });
  });

  const totalOccupancyPercent = grandTotal > 0 ? Math.round((grandOccupied / grandTotal) * 1000) / 10 : 0;

  return {
    success: true,
    hostels: hostelStats,
    totals: { totalRooms: grandTotal, occupied: grandOccupied, available: grandAvailable, other: grandOther, occupancyPercent: totalOccupancyPercent }
  };
}

/* forPwdStudent: true -> ONLY rooms marked pwdOnly="Yes".
 * false -> ONLY rooms NOT marked pwdOnly="Yes".
 * Enforcement point for the PWD room-reservation rule: PWD students
 * never land in a normal room, normal students never take a
 * reserved room. If Rooms has no "pwdOnly" column, every room is
 * treated as unreserved (backward compatible).
 * ===================================================== */
function getAvailableRoomInHostel(hostelId, forPwdStudent) {
  const roomsSheet = getSheet(CONFIG.SHEETS.ROOMS);
  const data = roomsSheet.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0];
  const hostelIdCol = headers.indexOf('hostelId');
  const roomIdCol = headers.indexOf('roomId');
  const statusCol = headers.indexOf('status');
  const pwdOnlyCol = headers.indexOf('pwdOnly');

  if (hostelIdCol === -1 || roomIdCol === -1 || statusCol === -1) {
    throw new Error('Required columns (hostelId, roomId, status) not found in Rooms sheet.');
  }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowHostelId = String(row[hostelIdCol]).trim();
    const rowStatus = String(row[statusCol]).trim().toLowerCase();

    if (rowHostelId !== String(hostelId).trim() || rowStatus !== 'available') continue;

    const isReservedForPwd = pwdOnlyCol !== -1 && isPwdYes(row[pwdOnlyCol]);

    // Strict, two-way separation.
    if (forPwdStudent && !isReservedForPwd) continue;
    if (!forPwdStudent && isReservedForPwd) continue;

    const room = {};
    for (let j = 0; j < headers.length; j++) room[headers[j]] = row[j];
    room._rowNumber = i + 1;
    return room;
  }

  return null;
}

function isGenderCompatible(student, hostel) {
  if (!student.gender || !hostel.gender) throw new Error('Gender information missing for compatibility check.');
  return String(student.gender).trim().toLowerCase() === String(hostel.gender).trim().toLowerCase();
}

function isHostelAvailable(hostel) {
  if (!hostel || !hostel.hostelId) throw new Error('Invalid hostel object passed to isHostelAvailable.');

  const roomsSheet = getSheet(CONFIG.SHEETS.ROOMS);
  const data = roomsSheet.getDataRange().getValues();
  if (data.length < 2) return false;

  const headers = data[0];
  const hostelIdCol = headers.indexOf('hostelId');
  const statusCol = headers.indexOf('status');
  if (hostelIdCol === -1 || statusCol === -1) throw new Error('Required columns (hostelId, status) not found in Rooms sheet.');

  for (let i = 1; i < data.length; i++) {
    const rowHostelId = String(data[i][hostelIdCol]).trim();
    const rowStatus = String(data[i][statusCol]).trim().toLowerCase();
    if (rowHostelId === String(hostel.hostelId).trim() && rowStatus === 'available') return true;
  }
  return false;
}

function isRoomAvailable(room) {
  if (!room || !room.status) throw new Error('Invalid room object passed to isRoomAvailable.');
  return String(room.status).trim().toLowerCase() === 'available';
}

function checkHardConstraints(student, hostel, room) {
  if (!isGenderCompatible(student, hostel)) {
    return { passed: false, reason: 'Gender mismatch between student and hostel.' };
  }
  if (!isHostelAvailable(hostel)) {
    return { passed: false, reason: 'Hostel has no available rooms (capacity full).' };
  }
  if (!isRoomAvailable(room)) {
    return { passed: false, reason: 'Selected room is not available (already occupied).' };
  }
  return { passed: true, reason: 'All hard constraints satisfied.' };
}

/* =====================================================
 * SOFT SCORING
 * ===================================================== */
function getAllocatedStudentsInHostel(hostelId) {
  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const data = studentsSheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const hostelIdCol = headers.indexOf('allocatedHostelId');
  const statusCol = headers.indexOf('applicationStatus');
  if (hostelIdCol === -1 || statusCol === -1) {
    throw new Error('Required columns (allocatedHostelId, applicationStatus) not found in Students sheet.');
  }

  const allocatedStudents = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[hostelIdCol]).trim() === String(hostelId).trim() && String(row[statusCol]).trim() === CONFIG.STATUS.ALLOCATED) {
      const student = {};
      for (let j = 0; j < headers.length; j++) student[headers[j]] = row[j];
      allocatedStudents.push(student);
    }
  }
  return allocatedStudents;
}

function calculateSoftScore(student, hostel, room) {
  let score = 0;

  // Hostel preference.
  if (student.hostelPreference && String(student.hostelPreference).trim() === String(hostel.hostelId).trim()) {
    score += CONFIG.SOFT_SCORES.HOSTEL_PREFERENCE;
  }

  // Existing students in the hostel.
  const allocatedStudents = getAllocatedStudentsInHostel(hostel.hostelId);
  let sameYearFound = false;
  let sameCourseFound = false;

  for (let i = 0; i < allocatedStudents.length; i++) {
    const existingStudent = allocatedStudents[i];
    if (!sameYearFound && String(existingStudent.year).trim() === String(student.year).trim()) sameYearFound = true;
    if (!sameCourseFound && String(existingStudent.course).trim().toLowerCase() === String(student.course).trim().toLowerCase()) sameCourseFound = true;
    if (sameYearFound && sameCourseFound) break;
  }

  if (sameYearFound) score += CONFIG.SOFT_SCORES.SAME_YEAR;
  if (sameCourseFound) score += CONFIG.SOFT_SCORES.SAME_COURSE;

  return score;
}

/* =====================================================
 * FIND BEST HOSTEL
 * ===================================================== */
function findBestHostelForStudent(student) {
  const allHostels = getAllHostels();
  const studentIsPwd = isPwdYes(student.pwd);

  let bestHostel = null;
  let bestRoom = null;
  let bestScore = -1;

  for (let i = 0; i < allHostels.length; i++) {
    const hostel = allHostels[i];
    const availableRoom = getAvailableRoomInHostel(hostel.hostelId, studentIsPwd);
    if (!availableRoom) continue;

    const constraintResult = checkHardConstraints(student, hostel, availableRoom);
    if (!constraintResult.passed) continue;

    const score = calculateSoftScore(student, hostel, availableRoom);

    if (score > bestScore || (score === bestScore && bestHostel && String(hostel.hostelId) < String(bestHostel.hostelId))) {
      bestScore = score;
      bestHostel = hostel;
      bestRoom = availableRoom;
    }
  }

  if (!bestHostel) {
    return {
      found: false,
      reason: studentIsPwd
        ? 'No eligible PWD-reserved room with available capacity was found for this student.'
        : 'No eligible hostel with available room found for this student.'
    };
  }

  return { found: true, hostel: bestHostel, room: bestRoom, score: bestScore };
}

/* =====================================================
 * RUN ALLOCATION
 * ===================================================== */
function runAllocation(batchId, adminKey, limit) {
  verifyAdminAccess(adminKey);
  if (!batchId || String(batchId).trim() === '') throw new Error('Batch ID is required to run allocation.');

  const targetBatchId = String(batchId).trim();
  const students = getStudentsByBatch(targetBatchId);

  // Only students still waiting (status === 'Registered') are
  // candidates this round. Already Allocated/Not Allocated students
  // from a previous run are left untouched.
  const pendingStudents = students.filter(function (s) {
    return String(s.applicationStatus || CONFIG.STATUS.REGISTERED).trim() === CONFIG.STATUS.REGISTERED;
  });

  // Among pending students, only those with a completed hostel form
  // are allocatable this round. The rest are skipped (left pending).
  const eligibleStudents = [];
  let skippedIncompleteCount = 0;

  pendingStudents.forEach(function (s) {
    if (isStudentProfileComplete(s)) eligibleStudents.push(s);
    else skippedIncompleteCount++;
  });

  if (eligibleStudents.length === 0) {
    return {
      success: true, batchId: targetBatchId, totalStudents: students.length, allocated: 0, notAllocated: 0,
      skippedIncomplete: skippedIncompleteCount,
      message: skippedIncompleteCount > 0
        ? 'No new students are ready for allocation yet (' + skippedIncompleteCount + ' student(s) have not completed their hostel form).'
        : 'No new students are pending allocation right now.'
    };
  }

  const sortedStudents = sortStudentsForAllocation(eligibleStudents);

  /* OPTIONAL LIMIT: only run this round for the first N students in
   * priority order. Remaining eligible students (rank N+1 onward)
   * are left untouched — still 'Registered' — so the admin can run
   * allocation again later to pick up where this round left off.
   */
  const numericLimit = Number(limit);
  const effectiveLimit = (limit !== undefined && limit !== null && String(limit).trim() !== '' && !isNaN(numericLimit) && numericLimit > 0)
    ? Math.floor(numericLimit)
    : null;

  const studentsToProcess = effectiveLimit ? sortedStudents.slice(0, effectiveLimit) : sortedStudents;
  const leftPendingCount = sortedStudents.length - studentsToProcess.length;

  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const roomsSheet = getSheet(CONFIG.SHEETS.ROOMS);
  const studentHeaders = studentsSheet.getDataRange().getValues()[0];

  const allocatedHostelIdCol = studentHeaders.indexOf('allocatedHostelId') + 1;
  const allocatedRoomIdCol = studentHeaders.indexOf('allocatedRoomId') + 1;
  const allocationScoreCol = studentHeaders.indexOf('allocationScore') + 1;
  const applicationStatusCol = studentHeaders.indexOf('applicationStatus') + 1;

  if (allocatedHostelIdCol === 0 || allocatedRoomIdCol === 0 || allocationScoreCol === 0 || applicationStatusCol === 0) {
    throw new Error('Required allocation columns are missing from Students sheet.');
  }

  const roomHeaders = roomsSheet.getDataRange().getValues()[0];
  const roomStatusCol = roomHeaders.indexOf('status') + 1;
  if (roomStatusCol === 0) throw new Error('status column not found in Rooms sheet.');

  let allocatedCount = 0;
  let notAllocatedCount = 0;

  for (let i = 0; i < studentsToProcess.length; i++) {
    const student = studentsToProcess[i];
    const result = findBestHostelForStudent(student);

    if (result.found) {
      studentsSheet.getRange(student._rowNumber, allocatedHostelIdCol).setValue(result.hostel.hostelId);
      studentsSheet.getRange(student._rowNumber, allocatedRoomIdCol).setValue(result.room.roomId);
      studentsSheet.getRange(student._rowNumber, allocationScoreCol).setValue(result.score);
      studentsSheet.getRange(student._rowNumber, applicationStatusCol).setValue(CONFIG.STATUS.ALLOCATED);
      roomsSheet.getRange(result.room._rowNumber, roomStatusCol).setValue('Occupied');
      allocatedCount++;
    } else {
      studentsSheet.getRange(student._rowNumber, applicationStatusCol).setValue(CONFIG.STATUS.NOT_ALLOCATED);
      notAllocatedCount++;
    }
  }

  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);

  // Every allocation run hides results and requires the admin to
  // manually publish again, so a second run never silently
  // re-exposes stale/updated results without an explicit publish.
  updateSetting(settingsSheet, 'resultStatus', 'HIDDEN');
  updateSetting(settingsSheet, 'allocationStatus', 'COMPLETED');

  SpreadsheetApp.flush();

  return {
    success: true,
    batchId: targetBatchId,
    totalStudents: students.length,
    allocated: allocatedCount,
    notAllocated: notAllocatedCount,
    skippedIncomplete: skippedIncompleteCount,
    limitApplied: effectiveLimit,
    leftPending: leftPendingCount,
    message: 'Allocation run complete for this round: ' + allocatedCount + ' allocated, ' + notAllocatedCount + ' not allocated' +
      (skippedIncompleteCount > 0 ? ', ' + skippedIncompleteCount + ' skipped (form not yet completed)' : '') +
      (effectiveLimit ? ', ' + leftPendingCount + ' left pending (limit of ' + effectiveLimit + ' applied)' : '') +
      '. You can run allocation again later for any newly registered students without resetting.'
  };
}

/* =====================================================
 * PUBLISH / UNPUBLISH RESULTS
 * ===================================================== */
function publishResults(batchId, adminKey, remark) {
  verifyAdminAccess(adminKey);
  if (!batchId || String(batchId).trim() === '') throw new Error('Batch ID is required to publish results.');

  const targetBatchId = String(batchId).trim();
  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);
  const settings = getSettings(settingsSheet);

  if (settings.allocationStatus !== 'COMPLETED') {
    throw new Error('Cannot publish results: allocation has not been completed yet.');
  }

  updateSetting(settingsSheet, 'resultStatus', 'PUBLISHED');

  // Optional admin remark shown to students on the result card
  // instead of the default heading. Persists until published again.
  const remarkValue = remark === undefined || remark === null ? '' : String(remark).trim();
  try {
    updateSetting(settingsSheet, 'resultRemark', remarkValue);
  } catch (e) {
    // Setting row doesn't exist yet - add it.
    settingsSheet.appendRow(['resultRemark', remarkValue]);
  }

  return {
    success: true, batchId: targetBatchId, resultStatus: 'PUBLISHED', resultRemark: remarkValue,
    message: 'Results have been published. Students can now view their allocation.'
  };
}

function unpublishResults(batchId, adminKey) {
  verifyAdminAccess(adminKey);
  if (!batchId || String(batchId).trim() === '') throw new Error('Batch ID is required to unpublish results.');

  const targetBatchId = String(batchId).trim();
  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);
  updateSetting(settingsSheet, 'resultStatus', 'HIDDEN');

  return { success: true, batchId: targetBatchId, resultStatus: 'HIDDEN', message: 'Results have been hidden again.' };
}

/* =====================================================
 * BATCH SUMMARY
 * ===================================================== */
function getBatchSummary(batchId, adminKey) {
  verifyAdminAccess(adminKey);
  if (!batchId || String(batchId).trim() === '') throw new Error('Batch ID is required to get batch summary.');

  const targetBatchId = String(batchId).trim();
  const students = getStudentsByBatch(targetBatchId);

  let allocatedCount = 0, notAllocatedCount = 0, registeredCount = 0;
  for (let i = 0; i < students.length; i++) {
    const status = students[i].applicationStatus;
    if (status === CONFIG.STATUS.ALLOCATED) allocatedCount++;
    else if (status === CONFIG.STATUS.NOT_ALLOCATED) notAllocatedCount++;
    else if (status === CONFIG.STATUS.REGISTERED) registeredCount++;
  }

  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);
  const settings = getSettings(settingsSheet);

  return {
    success: true, batchId: targetBatchId, totalStudents: students.length,
    registered: registeredCount, allocated: allocatedCount, notAllocated: notAllocatedCount,
    allocationStatus: settings.allocationStatus, resultStatus: settings.resultStatus
  };
}

/* =====================================================
 * STUDENT RESULT
 * ===================================================== */
function getStudentResult(studentId) {
  if (!studentId || String(studentId).trim() === '') throw new Error('Student ID is required.');
  const targetStudentId = String(studentId).trim();

  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);
  const settings = getSettings(settingsSheet);

  // Do not reveal allocation information until admin publishes.
  if (settings.resultStatus !== 'PUBLISHED') {
    return { success: false, published: false, message: 'Results have not been published yet.' };
  }

  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const data = studentsSheet.getDataRange().getValues();
  if (data.length < 2) throw new Error('Student not found: ' + targetStudentId);

  const headers = data[0];
  const studentIdCol = headers.indexOf('studentid');
  const statusCol = headers.indexOf('applicationStatus');
  const hostelIdCol = headers.indexOf('allocatedHostelId');
  const roomIdCol = headers.indexOf('allocatedRoomId');

  if (studentIdCol === -1 || statusCol === -1 || hostelIdCol === -1 || roomIdCol === -1) {
    throw new Error('Required result columns are missing from Students sheet.');
  }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[studentIdCol]).trim() !== targetStudentId) continue;

    const status = row[statusCol];
    const hostelId = row[hostelIdCol];
    const roomId = row[roomIdCol];

    let hostelName = '';
    if (hostelId) {
      const hostel = getAllHostels().find(function (h) {
        return String(h.hostelId).trim() === String(hostelId).trim();
      });
      if (hostel) hostelName = hostel.hostelName || hostel.name || '';
    }

    return {
      success: true,
      published: true,
      studentId: targetStudentId,
      status: status,
      hostelId: hostelId || '',
      hostelName: hostelName,
      roomId: roomId || '',
      // Admin remark shown on the result card in place of the
      // default heading. Empty string = frontend falls back to default.
      remark: String(settings.resultRemark || '')
    };
  }

  throw new Error('Student not found: ' + targetStudentId);
}

/* =====================================================
 * ADMIN AUTHENTICATION
 * ===================================================== */
function setupAdminKey() {
  // Change this if you want to use a different key.
  const secretKey = '....(hidden for security purpose)';
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', secretKey);
  Logger.log('Admin key has been set successfully.');
}

function verifyAdminAccess(providedKey) {
  const storedKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!storedKey) throw new Error('Admin key not set up. Run setupAdminKey() first.');
  if (!providedKey || providedKey !== storedKey) throw new Error('Unauthorized admin action.');
  return true;
}

function verifyAdminKeyOnly(adminKey) {
  verifyAdminAccess(adminKey);
  return { success: true, message: 'Admin authenticated successfully.' };
}

function isFormSubmissionLocked() {
  const settings = getSettings(getSheet(CONFIG.SHEETS.SETTINGS));
  return String(settings.formSubmissionLocked || '').trim().toLowerCase() === 'yes';
}

function isFormEditLocked() {
  const settings = getSettings(getSheet(CONFIG.SHEETS.SETTINGS));
  return String(settings.formEditLocked || '').trim().toLowerCase() === 'yes';
}

function getFormLockStatus(adminKey) {
  verifyAdminAccess(adminKey);
  const settings = getSettings(getSheet(CONFIG.SHEETS.SETTINGS));
  return {
    success: true,
    formSubmissionLocked: String(settings.formSubmissionLocked || 'No').trim().toLowerCase() === 'yes',
    formEditLocked: String(settings.formEditLocked || 'No').trim().toLowerCase() === 'yes'
  };
}

function getFormLockStatusPublic() {
  const settings = getSettings(getSheet(CONFIG.SHEETS.SETTINGS));
  return {
    success: true,
    formSubmissionLocked: String(settings.formSubmissionLocked || 'No').trim().toLowerCase() === 'yes',
    formEditLocked: String(settings.formEditLocked || 'No').trim().toLowerCase() === 'yes'
  };
}

function getPublicAnnouncements() {
  const settings = getSettings(getSheet(CONFIG.SHEETS.SETTINGS));
  return {
    success: true,
    resultStatus: settings.resultStatus === 'PUBLISHED' ? 'PUBLISHED' : 'HIDDEN',
    resultRemark: String(settings.resultRemark || ''),
    formSubmissionLocked: String(settings.formSubmissionLocked || 'No').trim().toLowerCase() === 'yes',
    formEditLocked: String(settings.formEditLocked || 'No').trim().toLowerCase() === 'yes'
  };
}

function setFormLock(lockType, locked, adminKey) {
  verifyAdminAccess(adminKey);

  const key = lockType === 'submission' ? 'formSubmissionLocked' : lockType === 'edit' ? 'formEditLocked' : null;
  if (!key) throw new Error('Invalid lock type: ' + lockType);

  const value = locked ? 'Yes' : 'No';
  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);

  try {
    updateSetting(settingsSheet, key, value);
  } catch (e) {
    // Setting row doesn't exist yet - add it.
    settingsSheet.appendRow([key, value]);
  }

  return {
    success: true, key: key, locked: locked,
    message: (lockType === 'submission' ? 'Hostel form submissions are now ' : 'Hostel form editing is now ') + (locked ? 'LOCKED.' : 'unlocked.')
  };
}

/* =====================================================
 * RESET ALLOCATION
 * ===================================================== */
function resetAllocation(adminKey) {
  verifyAdminAccess(adminKey);

  // Reset rooms.
  const roomsSheet = getSheet(CONFIG.SHEETS.ROOMS);
  const roomsData = roomsSheet.getDataRange().getValues();

  if (roomsData.length >= 2) {
    const roomHeaders = roomsData[0];
    const statusCol = roomHeaders.indexOf('status') + 1;
    if (statusCol > 0) {
      for (let i = 1; i < roomsData.length; i++) {
        roomsSheet.getRange(i + 1, statusCol).setValue('Available');
      }
    }
  }

  // Reset allocation-related fields. IMPORTANT: we do NOT clear the
  // student's profile fields — resetting allocation is not the same
  // as allowing students to edit their submitted hostel form.
  const studentsSheet = getSheet(CONFIG.SHEETS.STUDENTS);
  const studentsData = studentsSheet.getDataRange().getValues();

  if (studentsData.length >= 2) {
    const studentHeaders = studentsData[0];
    const allocatedHostelIdCol = studentHeaders.indexOf('allocatedHostelId') + 1;
    const allocatedRoomIdCol = studentHeaders.indexOf('allocatedRoomId') + 1;
    const allocationScoreCol = studentHeaders.indexOf('allocationScore') + 1;
    const applicationStatusCol = studentHeaders.indexOf('applicationStatus') + 1;

    for (let i = 1; i < studentsData.length; i++) {
      if (allocatedHostelIdCol > 0) studentsSheet.getRange(i + 1, allocatedHostelIdCol).setValue('');
      if (allocatedRoomIdCol > 0) studentsSheet.getRange(i + 1, allocatedRoomIdCol).setValue('');
      if (allocationScoreCol > 0) studentsSheet.getRange(i + 1, allocationScoreCol).setValue('');
      // Profile remains intact; only allocation status is reset.
      if (applicationStatusCol > 0) studentsSheet.getRange(i + 1, applicationStatusCol).setValue(CONFIG.STATUS.REGISTERED);
    }
  }

  // Reset allocation/result state.
  const settingsSheet = getSheet(CONFIG.SHEETS.SETTINGS);
  updateSetting(settingsSheet, 'allocationStatus', 'NOT_RUN');
  updateSetting(settingsSheet, 'resultStatus', 'HIDDEN');

  SpreadsheetApp.flush();

  return { success: true, message: 'Allocation has been reset. Rooms are Available and allocation data has been cleared. Submitted student profiles remain locked.' };
}

/* =====================================================
 * CANCEL STUDENT ALLOCATION
 * ===================================================== */
function cancelStudentAllocation(studentId) {
  if (!studentId || String(studentId).trim() === '') throw new Error('Student ID is required.');
  const targetStudentId = String(studentId).trim();

  const settings = getSettings(getSheet(CONFIG.SHEETS.SETTINGS));
  if (settings.resultStatus !== 'PUBLISHED') {
    throw new Error('Cannot cancel allocation before results are published.');
  }

  const found = findStudentRow(targetStudentId);
  if (!found) throw new Error('Student not found.');

  const student = found.student;
  if (String(student.applicationStatus || '').trim() !== CONFIG.STATUS.ALLOCATED) {
    throw new Error('You do not have an active room allocation to cancel.');
  }

  const hostelId = String(student.allocatedHostelId || '').trim();
  const roomId = String(student.allocatedRoomId || '').trim();

  // Free the room back to Available.
  if (hostelId && roomId) {
    const roomsSheet = getSheet(CONFIG.SHEETS.ROOMS);
    const roomsData = roomsSheet.getDataRange().getValues();
    const roomHeaders = roomsData[0];
    const roomIdCol = roomHeaders.indexOf('roomId');
    const roomStatusCol = roomHeaders.indexOf('status');

    if (roomIdCol === -1 || roomStatusCol === -1) {
      throw new Error('Required columns (roomId, status) not found in Rooms sheet.');
    }

    for (let i = 1; i < roomsData.length; i++) {
      if (String(roomsData[i][roomIdCol]).trim() === roomId) {
        roomsSheet.getRange(i + 1, roomStatusCol + 1).setValue('Available');
        break;
      }
    }
  }

  const row = found._rowNumber || student._rowNumber;

  // Clear BOTH the allocation fields AND the entire hostel-form
  // profile. studentId/password stay intact.
  const clearMap = {
    name: '', email: '', course: '', gender: '', pwd: '', year: '',
    hostelPreference: '', housePincode: '', state: '', region: '', campusDistanceKm: '',
    allocatedHostelId: '', allocatedRoomId: '', allocationScore: '', applicationStatus: CONFIG.STATUS.REGISTERED
  };

  Object.keys(clearMap).forEach(function (key) {
    const col = found.headers.indexOf(key);
    if (col === -1) throw new Error('Column not found in Students sheet: ' + key);
    found.sheet.getRange(row, col + 1).setValue(clearMap[key]);
  });

  SpreadsheetApp.flush();

  return {
    success: true,
    message: 'Your allocation was cancelled, the room was freed, and your hostel form was cleared. Fill the form again to be considered in a future allocation round.',
    status: CONFIG.STATUS.REGISTERED
  };
}

/* =====================================================
 * JSON RESPONSE
 * ===================================================== */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================
 * POST API
 * ===================================================== */
function doPost(e) {
  try {
    let requestData;
    try {
      requestData = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return createJsonResponse({ success: false, message: 'Invalid JSON in request body.' });
    }

    const action = requestData.action;
    if (!action) return createJsonResponse({ success: false, message: 'Missing "action" field in request.' });

    switch (action) {

      case 'registerStudent': {
        // Only studentId and password are used; extra fields ignored.
        const result = registerStudent({ studentId: requestData.studentId, password: requestData.password });
        return createJsonResponse(result);
      }

      case 'getStudentProfile': {
        if (!requestData.studentId || String(requestData.studentId).trim() === '') {
          return createJsonResponse({ success: false, message: 'studentId is required.' });
        }
        return createJsonResponse(getStudentProfile(requestData.studentId));
      }

      case 'completeStudentProfile': {
        const result = completeStudentProfile({
          studentId: requestData.studentId, name: requestData.name, email: requestData.email,
          course: requestData.course, gender: requestData.gender, pwd: requestData.pwd,
          year: requestData.year, hostelPreference: requestData.hostelPreference,
          housePincode: requestData.housePincode, state: requestData.state
        });
        return createJsonResponse(result);
      }

      case 'editStudentProfile': {
        const result = editStudentProfile({
          studentId: requestData.studentId, name: requestData.name, email: requestData.email,
          course: requestData.course, gender: requestData.gender, pwd: requestData.pwd,
          year: requestData.year, hostelPreference: requestData.hostelPreference,
          housePincode: requestData.housePincode, state: requestData.state
        });
        return createJsonResponse(result);
      }

      case 'cancelRegistration': {
        if (!requestData.studentId || String(requestData.studentId).trim() === '') {
          return createJsonResponse({ success: false, message: 'studentId is required.' });
        }
        return createJsonResponse(cancelRegistration(requestData.studentId));
      }

      case 'cancelStudentAllocation': {
        if (!requestData.studentId || String(requestData.studentId).trim() === '') {
          return createJsonResponse({ success: false, message: 'studentId is required.' });
        }
        return createJsonResponse(cancelStudentAllocation(requestData.studentId));
      }

      case 'getStudentResult': {
        if (!requestData.studentId || String(requestData.studentId).trim() === '') {
          return createJsonResponse({ success: false, message: 'studentId is required.' });
        }
        return createJsonResponse(getStudentResult(requestData.studentId));
      }

      case 'runAllocation': {
        if (!requestData.batchId || String(requestData.batchId).trim() === '') {
          return createJsonResponse({ success: false, message: 'batchId is required.' });
        }
        return createJsonResponse(runAllocation(requestData.batchId, requestData.adminKey, requestData.limit));
      }

      case 'publishResults': {
        if (!requestData.batchId || String(requestData.batchId).trim() === '') {
          return createJsonResponse({ success: false, message: 'batchId is required.' });
        }
        return createJsonResponse(publishResults(requestData.batchId, requestData.adminKey, requestData.remark));
      }

      case 'unpublishResults': {
        if (!requestData.batchId || String(requestData.batchId).trim() === '') {
          return createJsonResponse({ success: false, message: 'batchId is required.' });
        }
        return createJsonResponse(unpublishResults(requestData.batchId, requestData.adminKey));
      }

      case 'getBatchSummary': {
        if (!requestData.batchId || String(requestData.batchId).trim() === '') {
          return createJsonResponse({ success: false, message: 'batchId is required.' });
        }
        return createJsonResponse(getBatchSummary(requestData.batchId, requestData.adminKey));
      }

      case 'getPriorityList': {
        if (!requestData.batchId || String(requestData.batchId).trim() === '') {
          return createJsonResponse({ success: false, message: 'batchId is required.' });
        }
        return createJsonResponse(getPriorityList(requestData.batchId, requestData.adminKey));
      }

      case 'getFormLockStatus':
        return createJsonResponse(getFormLockStatus(requestData.adminKey));

      case 'getFormLockStatusPublic':
        return createJsonResponse(getFormLockStatusPublic());

      case 'getPublicAnnouncements':
        return createJsonResponse(getPublicAnnouncements());

      case 'setFormLock': {
        if (!requestData.lockType) return createJsonResponse({ success: false, message: 'lockType is required.' });
        return createJsonResponse(setFormLock(requestData.lockType, !!requestData.locked, requestData.adminKey));
      }

      case 'getAllStudents': {
        if (!requestData.batchId || String(requestData.batchId).trim() === '') {
          return createJsonResponse({ success: false, message: 'batchId is required.' });
        }
        return createJsonResponse(getAllStudentsList(requestData.batchId, requestData.adminKey));
      }

      case 'getOccupancyStats':
        return createJsonResponse(getOccupancyStats(requestData.adminKey));

      case 'getStudentPriority': {
        if (!requestData.studentId || String(requestData.studentId).trim() === '') {
          return createJsonResponse({ success: false, message: 'studentId is required.' });
        }
        return createJsonResponse(getStudentPriority(requestData.studentId));
      }

      case 'loginStudent': {
        if (!requestData.studentId || String(requestData.studentId).trim() === '') {
          return createJsonResponse({ success: false, message: 'studentId is required.' });
        }
        if (!requestData.password || String(requestData.password).trim() === '') {
          return createJsonResponse({ success: false, message: 'password is required.' });
        }
        return createJsonResponse(loginStudent(requestData.studentId, requestData.password));
      }

      case 'resetAllocation':
        return createJsonResponse(resetAllocation(requestData.adminKey));

      case 'verifyAdmin':
        return createJsonResponse(verifyAdminKeyOnly(requestData.adminKey));

      default:
        return createJsonResponse({ success: false, message: 'Unknown action: ' + action });
    }
  } catch (error) {
    return createJsonResponse({ success: false, message: error.message || 'An unexpected error occurred.' });
  }
}

/* =====================================================
 * GET API
 * ===================================================== */
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (!action) return createJsonResponse({ success: false, message: 'Missing "action" parameter in request.' });

    switch (action) {
      case 'getStudentResult': {
        const studentId = e.parameter.studentId;
        if (!studentId || String(studentId).trim() === '') {
          return createJsonResponse({ success: false, message: 'studentId is required.' });
        }
        return createJsonResponse(getStudentResult(studentId));
      }

      default:
        return createJsonResponse({ success: false, message: 'Unknown or unsupported GET action: ' + action + '. Admin actions must use POST.' });
    }
  } catch (error) {
    return createJsonResponse({ success: false, message: error.message || 'An unexpected error occurred.' });
  }
}

/* =====================================================
 * DEV TOOLS (manual testing only — not used by doGet/doPost)
 * Safe to delete entirely in production; kept here for convenience
 * when debugging inside the Apps Script editor.
 * ===================================================== */
function testConnection() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  Logger.log('Spreadsheet connected successfully!');
  Logger.log('Spreadsheet name: ' + ss.getName());
}

function testSheets() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  Logger.log('Students sheet: ' + ss.getSheetByName(CONFIG.SHEETS.STUDENTS).getName());
  Logger.log('Hostels sheet: ' + ss.getSheetByName(CONFIG.SHEETS.HOSTELS).getName());
  Logger.log('Rooms sheet: ' + ss.getSheetByName(CONFIG.SHEETS.ROOMS).getName());
  Logger.log('Settings sheet: ' + ss.getSheetByName(CONFIG.SHEETS.SETTINGS).getName());
}

function testRegisterStudent() {
  const result = registerStudent({ studentId: 'TEST_NEW_STUDENT', password: 'test1234' });
  Logger.log(JSON.stringify(result));
}

function testProfileLock() {
  // Change this to a real student ID.
  Logger.log(JSON.stringify(getStudentProfile('ST003')));
}

function testDoGet() {
  Logger.log('Test 1: ' + doGet({ parameter: {} }).getContent());
  Logger.log('Test 2: ' + doGet({ parameter: { action: 'getStudentResult', studentId: 'TEST999' } }).getContent());
  Logger.log('Test 3: ' + doGet({ parameter: { action: 'runAllocation', batchId: 'BATCH-001' } }).getContent());
}

function testResetAllocation() {
  Logger.log(JSON.stringify(resetAllocation('SIH2024_HostelAdmin_9x7K2m')));
}

function testPriorityList() {
  // Change this to a real batch ID.
  Logger.log(JSON.stringify(getPriorityList('BATCH-001', '(hidden)')));
}
