// IndexedDB Setup
const DB_NAME = 'DECA_Exams_DB';
const DB_VERSION = 1;
const STORE_NAME = 'exams';
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (e) => reject('IndexedDB error: ' + e.target.errorCode);
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

function saveExam(exam) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(exam);
        request.onsuccess = () => resolve(exam.id);
        request.onerror = () => reject(request.error);
    });
}

function getAllExams() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function updateScore(id, newScore, answers) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const exam = getReq.result;
            if (exam) {
                exam.previousScore = newScore;
                if (answers !== undefined) exam.lastAnswers = answers;
                store.put(exam).onsuccess = () => resolve();
            } else {
                resolve();
            }
        };
    });
}

function deleteExam(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Elements
const uploadScreen = document.getElementById('upload-screen');
const quizScreen = document.getElementById('quiz-screen');
const resultsScreen = document.getElementById('results-screen');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('pdf-upload');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');

const qNumberEl = document.getElementById('q-number');
const qTextEl = document.getElementById('q-text');
const optionsContainer = document.getElementById('options-container');
const gridNav = document.getElementById('grid-nav');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const submitBtn = document.getElementById('submit-btn');
const beginBtn = document.getElementById('begin-btn');
const timerDisplay = document.getElementById('timer-display');
const startScreen = document.getElementById('start-screen');

// State
let questions = [];
let userAnswers = {}; // { questionIndex: 'A'|'B'|'C'|'D' }
let currentQuestionIndex = 0;
let timerInterval = null;
let currentExamId = null;

// Initialize App
initDB().then(() => loadLibrary()).catch(err => console.error(err));

async function loadLibrary() {
    try {
        const exams = await getAllExams();
        const libraryPanel = document.getElementById('library-panel');
        const grid = document.getElementById('library-grid');
        
        if (!libraryPanel || exams.length === 0) {
            if(libraryPanel) libraryPanel.style.display = 'none';
            return;
        }
        
        libraryPanel.style.display = 'block';
        grid.innerHTML = '';
        
        exams.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
        
        exams.forEach(exam => {
            const dateStr = new Date(exam.dateAdded).toLocaleDateString();
            const scoreStr = exam.previousScore !== null ? `Previous Score: ${exam.previousScore}%` : 'Not taken yet';
            
            const card = document.createElement('div');
            card.className = 'library-card';
            card.innerHTML = `
                <div class="library-card-header">
                    <div class="library-card-title">${exam.fileName}</div>
                    <button class="delete-exam-btn" title="Delete Exam"><i class="ph ph-trash"></i></button>
                </div>
                <div class="library-card-score">${scoreStr}</div>
                <div class="library-card-date">Added: ${dateStr}</div>
                <div style="display:flex; gap:0.5rem; margin-top: auto;">
                    <button class="library-card-btn redo-btn" style="flex:1;">Redo Exam</button>
                    ${exam.lastAnswers ? `<button class="library-card-btn tracker-btn" style="flex:1; background: var(--success);"><i class="ph ph-copy"></i> Tracker</button>` : ''}
                </div>
            `;
            card.querySelector('.redo-btn').onclick = () => {
                currentExamId = exam.id;
                questions = JSON.parse(JSON.stringify(exam.questions));
                document.getElementById('exam-stats-text').textContent = `Loaded ${questions.length} questions from ${exam.fileName}.`;
                document.getElementById('setting-count').max = questions.length;
                document.getElementById('setting-count').value = questions.length;
                uploadScreen.classList.remove('active');
                startScreen.classList.add('active');
            };
            card.querySelector('.delete-exam-btn').onclick = async (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this saved exam?')) {
                    await deleteExam(exam.id);
                    loadLibrary();
                }
            };
            const trackerBtn = card.querySelector('.tracker-btn');
            if (trackerBtn) {
                trackerBtn.onclick = (e) => {
                    e.stopPropagation();
                    openTrackerModal(exam.questions, exam.lastAnswers);
                };
            }
            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load library', e);
    }
}

// Disable PDF.js worker to prevent CORS and loading hangs
pdfjsLib.GlobalWorkerOptions.disableWorker = true;

// --- Event Listeners ---

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

prevBtn.addEventListener('click', () => {
    if (currentQuestionIndex > 0) goToQuestion(currentQuestionIndex - 1);
});
nextBtn.addEventListener('click', () => {
    if (currentQuestionIndex < questions.length - 1) goToQuestion(currentQuestionIndex + 1);
});
submitBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to submit your exam?')) {
        submitExam();
    }
});
beginBtn.addEventListener('click', () => {
    startExam();
});
document.getElementById('restart-btn').addEventListener('click', () => {
    location.reload();
});

// Exam Tracker Modal
const trackerModal = document.getElementById('tracker-modal');
let _trackerQuestions = null;
let _trackerAnswers = null;

function openTrackerModal(qs, ans) {
    _trackerQuestions = qs || questions;
    _trackerAnswers = ans || userAnswers;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tracker-date').value = today;
    trackerModal.classList.remove('hidden');
}

document.getElementById('copy-tracker-btn').addEventListener('click', () => {
    openTrackerModal(questions, userAnswers);
});
document.getElementById('tracker-cancel-btn').addEventListener('click', () => {
    trackerModal.classList.add('hidden');
});
trackerModal.addEventListener('click', (e) => {
    if (e.target === trackerModal) trackerModal.classList.add('hidden');
});
document.getElementById('tracker-confirm-btn').addEventListener('click', () => {
    copyToTracker();
});

function copyToTracker() {
    const rawDate = document.getElementById('tracker-date').value;
    const examNum = document.getElementById('tracker-exam-num').value;
    const level = document.getElementById('tracker-level').value;

    // Format date as MM/DD/YYYY to match sheet
    let dateStr = rawDate;
    if (rawDate) {
        const [y, m, d] = rawDate.split('-');
        dateStr = `${m}/${d}/${y}`;
    }

    const qs = _trackerQuestions || questions;
    const ans = _trackerAnswers || userAnswers;

    const rows = [];
    qs.forEach((q, idx) => {
        const userAns = ans[idx];
        const isCorrect = userAns === q.correct;
        const result = isCorrect ? 'correct' : 'incorrect';
        const origNum = q.originalNum || q.num;

        // Parse PI code: e.g. "FI-LAP-630" or "FI-630" → codeArea="FI", codeNum="630"
        let codeArea = '';
        let codeNum = '';
        if (q.piCode) {
            const piMatch = q.piCode.match(/^([A-Z]+)[-–](?:[A-Z]+-)?([\d]+)/);
            if (piMatch) {
                codeArea = piMatch[1];
                codeNum = piMatch[2];
            } else {
                codeArea = q.piCode;
            }
        }

        rows.push([dateStr, examNum, level, origNum, result, codeArea, codeNum].join('\t'));
    });

    const tsv = rows.join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
        trackerModal.classList.add('hidden');
        showToast(`✓ ${qs.length} rows copied! Paste into Google Sheets.`);
    }).catch(() => {
        // Fallback for file:// protocol
        const ta = document.createElement('textarea');
        ta.value = tsv;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        trackerModal.classList.add('hidden');
        showToast(`✓ ${qs.length} rows copied! Paste into Google Sheets.`);
    });
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'copy-success-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}


// --- Functions ---

async function handleFile(file) {
    const fileName = file.name;
    const isPDF = file.type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    const isCustom = fileName.toLowerCase().endsWith('.decaexam') || fileName.toLowerCase().endsWith('.json');

    if (!isPDF && !isCustom) {
        showError('Please upload a valid PDF or .decaexam file.');
        return;
    }

    showError('');
    dropZone.classList.add('hidden');
    loadingIndicator.classList.remove('hidden');

    try {
        if (isCustom) {
            loadingIndicator.querySelector('p').textContent = 'Loading custom exam...';
            const text = await file.text();
            try {
                const examData = JSON.parse(text);
                if (examData && examData.questions && Array.isArray(examData.questions)) {
                    questions = examData.questions;
                } else {
                    throw new Error("Invalid .decaexam format");
                }
            } catch(e) {
                loadingIndicator.querySelector('p').textContent = 'Error: Invalid custom exam file.';
                loadingIndicator.querySelector('.spinner').style.display = 'none';
                return;
            }
        } else {
            const text = await extractTextFromPDF(file);
            
            loadingIndicator.querySelector('p').textContent = 'Analyzing questions and answer key...';
            await new Promise(r => setTimeout(r, 100)); // Allow UI to update
            
            try {
                parseDECAExam(text);
            } catch (e) {
                loadingIndicator.querySelector('p').textContent = 'Parse Error: ' + e.message;
                loadingIndicator.querySelector('.spinner').style.display = 'none';
                return;
            }
            
            if (questions.length === 0) {
                loadingIndicator.querySelector('p').textContent = 'Error: Could not find any questions. Make sure it is a standard DECA exam.';
                loadingIndicator.querySelector('.spinner').style.display = 'none';
                return;
            }
        }

        const newExam = {
            id: Date.now().toString(),
            fileName: fileName,
            questions: JSON.parse(JSON.stringify(questions)),
            previousScore: null,
            dateAdded: new Date().toISOString()
        };
        
        await saveExam(newExam);
        currentExamId = newExam.id;
        loadLibrary();

        // Show start screen instead of directly starting
        document.getElementById('exam-stats-text').textContent = `We found ${questions.length} questions in this exam.`;
        document.getElementById('setting-count').max = questions.length;
        document.getElementById('setting-count').value = questions.length;

        uploadScreen.classList.remove('active');
        startScreen.classList.add('active');
    } catch (err) {
        console.error(err);
        quizScreen.classList.remove('active');
        uploadScreen.classList.add('active');
        loadingIndicator.querySelector('p').textContent = 'Error: ' + err.message;
        loadingIndicator.querySelector('.spinner').style.display = 'none';
    }
}

function showError(msg) {
    errorMessage.textContent = msg;
    if (msg) errorMessage.classList.remove('hidden');
    else errorMessage.classList.add('hidden');
}

async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    loadingIndicator.querySelector('p').textContent = 'Loading document structure...';
    
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        loadingIndicator.querySelector('p').textContent = `Extracting text: Page ${i} of ${pdf.numPages}...`;
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let lastY = -1;
        for(let item of content.items) {
            if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
                fullText += '\n';
            }
            fullText += item.str + ' '; // Added space to prevent glued words
            lastY = item.transform[5];
        }
        fullText += '\n';
    }
    
    loadingIndicator.querySelector('p').textContent = 'Analyzing questions and answer key...';
    return fullText;
}

function parseDECAExam(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    questions = [];
    let mode = 'SEARCH_Q'; // SEARCH_Q -> Q -> KEY
    let currentQ = 0;
    let expectedKeyNum = 1;
    let currentType = null; // 'text', 'A', 'B', 'C', 'D', 'exp', 'source'

    for (let line of lines) {
        // Skip header/footer lines
        if (line.match(/^20\d{2} HS ICDC/) || line.match(/^Copyright ©/)) continue;

        if (mode === 'SEARCH_Q' || mode === 'Q') {
            // Match "1. Question text" (Forgiving spaces)
            let qMatch = line.match(/^(\d+)\s*\.\s*(.*)/);
            if (qMatch && parseInt(qMatch[1]) === currentQ + 1) {
                currentQ++;
                questions.push({
                    num: currentQ,
                    text: qMatch[2],
                    A: '', B: '', C: '', D: '',
                    correct: '', explanation: '', piCode: ''
                });
                mode = 'Q';
                currentType = 'text';
                continue;
            }

            // Match answer key start "1. C"
            let keyMatch = line.match(/^(\d+)\s*\.\s*([A-D])(?:\s+(.*))?$/i);
            if (mode === 'Q' && currentQ >= 50 && keyMatch && parseInt(keyMatch[1]) === expectedKeyNum) {
                mode = 'KEY';
                processKeyLine(keyMatch);
                continue;
            }

            if (mode === 'Q') {
                let optMatch = line.match(/^([A-D])\s*\.\s*(.*)/i);
                if (optMatch) {
                    let currentLetter = optMatch[1].toUpperCase();
                    let remainder = optMatch[2];
                    
                    while (true) {
                        let nextOptMatch = remainder.match(/(.*?)\s+([B-D])\s*\.\s+(.*)/i);
                        
                        if (nextOptMatch && nextOptMatch[2].toUpperCase().charCodeAt(0) > currentLetter.charCodeAt(0)) {
                            questions[currentQ - 1][currentLetter] = nextOptMatch[1].trim();
                            currentLetter = nextOptMatch[2].toUpperCase();
                            remainder = nextOptMatch[3];
                        } else {
                            questions[currentQ - 1][currentLetter] = remainder.trim();
                            currentType = currentLetter;
                            break;
                        }
                    }
                } else if (currentType) {
                    questions[currentQ - 1][currentType] += ' ' + line;
                }
            }
        } else if (mode === 'KEY') {
            let keyMatch = line.match(/^(\d+)\s*\.\s*([A-D])(?:\s+(.*))?$/i);
            if (keyMatch && parseInt(keyMatch[1]) === expectedKeyNum) {
                processKeyLine(keyMatch);
                continue;
            }

            if (currentType === 'exp') {
                if (line.startsWith('SOURCE:')) {
                    if (questions[expectedKeyNum - 2]) {
                        questions[expectedKeyNum - 2].piCode = line.replace('SOURCE:', '').trim();
                    }
                    currentType = 'source';
                } else {
                    if (questions[expectedKeyNum - 2]) {
                        questions[expectedKeyNum - 2].explanation += line + ' ';
                    }
                }
            } else if (currentType === 'source') {
                // ignoring secondary source lines for simplicity
            }
        }
    }

    function processKeyLine(match) {
        expectedKeyNum++;
        let qIndex = parseInt(match[1]) - 1;
        if (questions[qIndex]) {
            questions[qIndex].correct = match[2].toUpperCase();
            questions[qIndex].explanation = match[3] ? match[3] + ' ' : '';
        }
        currentType = 'exp';
    }
}

function startExam() {
    // Apply Settings
    const enableTimer = document.getElementById('setting-timer').checked;
    const shuffleQuestions = document.getElementById('setting-shuffle').checked;
    let questionCount = parseInt(document.getElementById('setting-count').value);
    
    if (isNaN(questionCount) || questionCount < 1) questionCount = 1;
    if (questionCount > questions.length) questionCount = questions.length;

    if (shuffleQuestions) {
        // Fisher-Yates shuffle
        for (let i = questions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [questions[i], questions[j]] = [questions[j], questions[i]];
        }
    }

    // Limit array to question count
    questions = questions.slice(0, questionCount);
    
    // Re-assign numbers (1 to N) so UI makes sense
    questions.forEach((q, idx) => {
        q.originalNum = q.num; // preserve original number for review
        q.num = idx + 1;
    });

    startScreen.classList.remove('active');
    quizScreen.classList.add('active');

    // Init Navigator
    gridNav.innerHTML = '';
    questions.forEach((q, idx) => {
        const dot = document.createElement('div');
        dot.className = 'nav-dot';
        dot.textContent = q.num;
        dot.onclick = () => goToQuestion(idx);
        gridNav.appendChild(dot);
    });

    userAnswers = {};
    
    if (enableTimer) {
        document.getElementById('timer-container').classList.remove('hidden');
        timeRemaining = 75 * 60;
        startTimer();
    } else {
        document.getElementById('timer-container').classList.add('hidden');
    }
    
    goToQuestion(0);
}

function goToQuestion(index) {
    currentQuestionIndex = index;
    const q = questions[index];
    
    qNumberEl.textContent = `Question ${q.num} of ${questions.length}`;
    qTextEl.textContent = q.text;

    optionsContainer.innerHTML = '';
    ['A', 'B', 'C', 'D'].forEach(letter => {
        if (!q[letter]) return;
        
        const optDiv = document.createElement('div');
        optDiv.className = `option ${userAnswers[index] === letter ? 'selected' : ''}`;
        optDiv.onclick = () => selectOption(index, letter);
        
        optDiv.innerHTML = `
            <div class="option-letter">${letter}</div>
            <div class="option-text">${q[letter]}</div>
        `;
        optionsContainer.appendChild(optDiv);
    });

    // Update buttons
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === questions.length - 1;

    // Update navigator
    document.querySelectorAll('.nav-dot').forEach((dot, idx) => {
        dot.classList.remove('current');
        if (idx === index) dot.classList.add('current');
    });
}

function selectOption(qIndex, letter) {
    userAnswers[qIndex] = letter;
    // Update navigator
    document.querySelectorAll('.nav-dot')[qIndex].classList.add('answered');
    // Re-render current options
    goToQuestion(qIndex);
}

function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            alert("Time's up!");
            submitExam();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const m = Math.floor(timeRemaining / 60).toString().padStart(2, '0');
    const s = (timeRemaining % 60).toString().padStart(2, '0');
    timerDisplay.textContent = `${m}:${s}`;
    if (timeRemaining < 300) { // 5 minutes warning
        timerDisplay.style.color = 'var(--error)';
    }
}

function submitExam() {
    clearInterval(timerInterval);
    quizScreen.classList.remove('active');
    resultsScreen.classList.add('active');

    let correctCount = 0;
    const reviewContainer = document.getElementById('review-container');
    reviewContainer.innerHTML = '';

    questions.forEach((q, idx) => {
        const userAns = userAnswers[idx];
        const isCorrect = userAns === q.correct;
        if (isCorrect) correctCount++;

        const reviewItem = document.createElement('div');
        reviewItem.className = 'review-item';
        
        reviewItem.innerHTML = `
            <div class="review-header">
                <span class="review-qnum">Question ${q.originalNum || q.num} <span class="${isCorrect ? 'correct-badge' : 'incorrect-badge'}">${isCorrect ? '✓ Correct' : '✗ Incorrect'}</span></span>
                ${q.piCode ? `<span class="review-pi">${q.piCode}</span>` : ''}
            </div>
            <div class="review-question">${q.text}</div>
            <div class="review-answers">
                <div>
                    <p>Your Answer:</p>
                    <span class="user-ans" style="color: ${isCorrect ? 'var(--success)' : 'var(--error)'}">${userAns ? `${userAns}. ${q[userAns]}` : 'Skipped'}</span>
                </div>
                ${!isCorrect && q.correct ? `
                <div>
                    <p>Correct Answer:</p>
                    <span class="correct-ans" style="color: var(--success)">${q.correct}. ${q[q.correct]}</span>
                </div>
                ` : ''}
            </div>
            ${q.explanation ? `
            <div class="review-explanation">
                <strong>Explanation:</strong> ${q.explanation}
            </div>
            ` : ''}
        `;
        reviewContainer.appendChild(reviewItem);
    });

    document.getElementById('correct-count').textContent = correctCount;
    
    // Animate circle
    const percentage = Math.round((correctCount / questions.length) * 100);
    document.getElementById('score-text').textContent = `${percentage}%`;
    
    if (currentExamId) {
        updateScore(currentExamId, percentage, userAnswers).then(() => loadLibrary());
    }

    setTimeout(() => {
        document.getElementById('score-circle-path').setAttribute('stroke-dasharray', `${percentage}, 100`);
        // Color based on score
        if (percentage >= 80) document.getElementById('score-circle-path').style.stroke = 'var(--success)';
        else if (percentage >= 60) document.getElementById('score-circle-path').style.stroke = 'var(--primary)';
        else document.getElementById('score-circle-path').style.stroke = 'var(--error)';
    }, 100);
}
