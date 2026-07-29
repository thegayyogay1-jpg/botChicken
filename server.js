const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 📌 1. ตั้งค่าตัวแปรระบบและ Global Variables
// ==========================================
const ADMIN_LIST = ['U4a0d60e9af37aa9fe66cf3e97d01cddb']; // 👈 ใส่ LINE User ID ของแอดมิน
const TOTAL_LEGS = 16; // 🔒 ฟิกไว้ที่ 16 ขาเสมอ

let usersWallets = {};
let nextMemberId = 1;

let defaultBetPrice = 10;   // ราคาต่อขา (แอดมินปรับเปลี่ยนได้)

// ตัวแปรควบคุมรอบการเล่น
let isRoundOpen = false;
let occupiedLegs = {};      // เก็บสถานะขา { 1: userId, 2: userId, ... }
let roundBets = {};         // เก็บรายละเอียดการแทง
let pendingResults = null;

// ==========================================
// 📌 2. ฟังก์ชัน Helper
// ==========================================
function getUserDisplayName(user) {
    if (!user) return "ไม่มีผู้เล่น";
    if (user.nickname) {
        return `${user.memberNumber}.${user.nickname}`;
    }
    return `สมาชิกที่ ${user.memberNumber}`;
}

function parseCardValue(token) {
    if (!token) return { score: 0, deng: 1 };
    let str = token.trim().toLowerCase();
    
    let deng = 1;
    if (str.includes('/')) {
        deng = 2;
        str = str.replace('/', '');
    } else if (str.endsWith('d')) {
        deng = 2;
        str = str.slice(0, -1);
    } else if (str.endsWith('k')) {
        deng = 3;
        str = str.slice(0, -1);
    }

    let score = parseFloat(str);
    if (isNaN(score)) score = 0;

    return { score, deng };
}

// ค้นหา UserId จาก เลขลำดับ หรือ ชื่อเล่น
function findUserIdByKeyword(keyword) {
    if (!keyword) return null;
    let cleanKey = keyword.toString().toLowerCase().replace('@', '').replace(/\s+/g, '');
    for (let uid in usersWallets) {
        let u = usersWallets[uid];
        let nicknameClean = (u.nickname || "").toLowerCase().replace(/\s+/g, '');
        if (u.memberNumber.toString() === cleanKey || nicknameClean === cleanKey) {
            return uid;
        }
    }
    return null;
}

app.get('/', (req, res) => {
    res.send('LINE Bot Server is running!');
});

// ==========================================
// 📌 3. LINE Webhook Handler
// ==========================================
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const source = event.source;
            const userId = source.userId;
            const groupId = source.groupId;
            const roomId = source.roomId;

            const originalMsg = event.message.text.trim();
            const userMsg = originalMsg.toLowerCase();
            const isAdmin = ADMIN_LIST.includes(userId);
            let replyMessageObject = null;

            // 🆔 [คำสั่งเช็ก ID]
            if (userMsg === 'id' || userMsg === 'myid') {
                let idInfoText = `🆔 **ข้อมูล LINE ID**\n------------------------\n`;
                if (userId) idInfoText += `👤 **User ID:**\n${userId}\n\n`;
                if (groupId) idInfoText += `👥 **Group ID:**\n${groupId}\n\n`;
                if (roomId) idInfoText += `🏠 **Room ID:**\n${roomId}\n\n`;
                idInfoText += `📌 *วาง User ID ในตัวแปร ADMIN_LIST ได้เลยครับ*`;

                replyMessageObject = { type: 'text', text: idInfoText };
            }
            // 🧽 [คำสั่งแอดมิน] ล้างระบบ
            else if (userMsg === 'ล้างระบบ') {
                if (!isAdmin) {
                    replyMessageObject = { type: 'text', text: "❌ คุณไม่ใช่แอดมิน" };
                } else {
                    usersWallets = {}; nextMemberId = 1; isRoundOpen = false; 
                    occupiedLegs = {}; roundBets = {}; pendingResults = null;
                    replyMessageObject = { type: 'text', text: "👑 [แอดมิน] ♻️ ล้างระบบสมาชิกและกระดานเรียบร้อยแล้วครับ!" };
                }
            }
            // ⚙️ [คำสั่งแอดมิน] กำหนดราคาต่อขา (ฟิกไว้ 16 ขา)
            else if (originalMsg.startsWith('ตั้งค่า') || originalMsg.startsWith('ราคา')) {
                if (!isAdmin) {
                    replyMessageObject = { type: 'text', text: `❌ คุณไม่ใช่แอดมิน!` };
                } else {
                    let matches = originalMsg.match(/\d+/g);
                    if (matches && matches.length >= 1) {
                        defaultBetPrice = parseInt(matches[0]);
                        let requiredHoldingPerLeg = (TOTAL_LEGS - 1) * 2 * defaultBetPrice;

                        replyMessageObject = { 
                            type: 'text', 
                            text: `⚙️ [แอดมิน - ตั้งค่าราคาสำเร็จ]\n------------------------\n🎲 จำนวนขา: **${TOTAL_LEGS} ขาคงที่**\n💵 ราคาเดิมพัน: **ขาละ ${defaultBetPrice} บาท**\n🔒 เงินค้ำประกันต่อขา: **${requiredHoldingPerLeg} บาท**` 
                        };
                    } else {
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ รูปแบบไม่ถูกต้อง ตัวอย่าง: **ราคา 20** หรือ **ตั้งค่า 20**` };
                    }
                }
            }
            // ระบบสร้างโปรไฟล์สมาชิกอัตโนมัติ
            else {
                if (!usersWallets[userId]) {
                    usersWallets[userId] = { 
                        memberNumber: nextMemberId,
                        memberTitle: `สมาชิกที่ ${nextMemberId}`,
                        nickname: "", 
                        balance: 0,
                        isLockWithdraw: false,
                        pendingWithdrawAmount: 0
                    };
                    nextMemberId++;
                }
                
                const user = usersWallets[userId];
                const displayName = getUserDisplayName(user);
                const mentionText = `👤 [${displayName}] `;

                // ==========================================
                // PART 1: เช็กยอด / ตั้งชื่อเล่น (c หรือ c/ชื่อเล่น)
                // ==========================================
                if (userMsg === 'c' || userMsg.startsWith('c/') || userMsg.startsWith('c ')) {
                    if (userMsg === 'c') {
                        let nameInfo = `👤 ชื่อแสดงผล: **${displayName}**`;
                        if (!user.nickname) nameInfo += `\n📌 *(พิมพ์ c/ชื่อเล่น เพื่อระบุชื่อเล่นเพิ่มเติมได้)*`;
                        
                        // ค้นหาว่าผู้เล่นถือขาไหนอยู่บ้างในรอบปัจจุบัน
                        let myCurrentLegs = [];
                        for (let leg in occupiedLegs) {
                            if (occupiedLegs[leg] === userId) {
                                myCurrentLegs.push(leg);
                            }
                        }
                        
                        let legStatus = myCurrentLegs.length > 0 
                            ? `🎲 ขาที่ลงอยู่รอบนี้: **ขา ${myCurrentLegs.join(', ')}**` 
                            : `🎲 ขาที่ลงอยู่รอบนี้: **ยังไม่ได้ลงขา**`;

                        replyMessageObject = { 
                            type: 'text', 
                            text: `💳 **ข้อมูลกระเป๋าเงิน**\n------------------------\n${nameInfo}\n🆔 ลำดับสมาชิก: **ลำดับที่ ${user.memberNumber}**\n💰 ยอดเงินคงเหลือ: **${user.balance.toFixed(1)}** บาท\n${legStatus}` 
                        };
                    } else {
                        let newNickname = originalMsg.replace(/^c[\/\s]+/i, '').trim();
                        if (newNickname) {
                            user.nickname = newNickname;
                            let updatedName = getUserDisplayName(user);
                            replyMessageObject = { 
                                type: 'text', 
                                text: `✅ บันทึกชื่อเล่นเรียบร้อย!\n👤 ชื่อแสดงผลในระบบ: **[${updatedName}]**\n💰 ยอดเงินคงเหลือ: **${user.balance.toFixed(1)}** บาท` 
                            };
                        } else {
                            replyMessageObject = { type: 'text', text: `❌ พิมพ์ชื่อเล่นไม่ถูกต้อง ตัวอย่าง: **c/ต้น**` };
                        }
                    }
                }

                // ==========================================
                // PART 2: ระบบเติมเงิน / ลบเงิน / ถอนเงิน
                // ==========================================
                else if (originalMsg.startsWith('เติม') || originalMsg.startsWith('ลบ')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        let isAdd = originalMsg.startsWith('เติม');
                        let actionName = isAdd ? "เติมเงิน" : "ลบยอด";
                        
                        let targetUserId = null;
                        let amount = 0;
                        const moneyMatch = originalMsg.match(/\d+$/);
                        if (moneyMatch) amount = parseInt(moneyMatch[0]);

                        let cleanText = originalMsg.replace('เติม', '').replace('ลบ', '').trim();
                        if (moneyMatch) cleanText = cleanText.substring(0, cleanText.lastIndexOf(moneyMatch[0])).trim();
                        
                        if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                            targetUserId = event.message.mention.mentions[0].userId;
                        } else {
                            targetUserId = findUserIdByKeyword(cleanText);
                        }

                        if (!targetUserId || isNaN(amount) || amount <= 0) {
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ ${actionName}ไม่สำเร็จ\n📌 ตัวอย่าง: **เติม 1 500** หรือ **ลบ ต้น 200**` };
                        } else {
                            let tUser = usersWallets[targetUserId];
                            if (isAdd) {
                                tUser.balance += amount;
                            } else {
                                tUser.balance = Math.max(0, tUser.balance - amount);
                            }
                            let tName = getUserDisplayName(tUser);
                            let sign = isAdd ? `+${amount}` : `-${amount}`;
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ✅ ${actionName}สำเร็จ! (${sign} บาท)\n👤 ให้แก่: **[${tName}]**\n💰 ยอดเงินคงเหลือ: ${tUser.balance.toFixed(1)} บาท` };
                        }
                    }
                }
                else if (userMsg.startsWith('ถอน')) {
                    if (user.isLockWithdraw) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ ไม่สามารถแจ้งถอนซ้ำได้! มีรายการถอนค้างอยู่ ${user.pendingWithdrawAmount} บาท` };
                    } else {
                        const amount = parseInt(userMsg.replace('ถอน', ''));
                        if (!isNaN(amount) && amount > 0) {
                            if (user.balance < amount) {
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ ยอดเงินในระบบไม่พอ (มีอยู่ ${user.balance.toFixed(1)} บ.)` };
                            } else {
                                user.isLockWithdraw = true;
                                user.pendingWithdrawAmount = amount;
                                replyMessageObject = {
                                    type: 'text',
                                    text: `🔔 [ระบบรับเรื่องแจ้งถอน]\n${mentionText}\n💰 ยอดที่ต้องการถอน: **${amount}** บาท\n🔒 Status: ล็อกกระเป๋าชั่วคราว`
                                };
                            }
                        }
                    }
                }
                else if (originalMsg.startsWith('Y ') || originalMsg.startsWith('y ')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน` };
                    } else {
                        const parts = originalMsg.trim().split(/\s+/);
                        let searchKey = parts[1] ? parts[1] : '';
                        let targetUserId = findUserIdByKeyword(searchKey);

                        if (!targetUserId) {
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ ไม่พบสมาชิกรายการนี้` };
                        } else {
                            const targetUser = usersWallets[targetUserId];
                            if (!targetUser.isLockWithdraw || targetUser.pendingWithdrawAmount <= 0) {
                                replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ สมาชิกไม่ได้แจ้งถอนค้างไว้` };
                            } else {
                                let amount = targetUser.pendingWithdrawAmount;
                                targetUser.balance -= amount;
                                targetUser.isLockWithdraw = false;
                                targetUser.pendingWithdrawAmount = 0;
                                let tName = getUserDisplayName(targetUser);
                                replyMessageObject = { 
                                    type: 'text', 
                                    text: `👑 [แอดมิน] ✅ อนุมัติถอนสำเร็จ!\n👤 **[${tName}]**\n📉 หักยอด: -${amount} บาท\n💰 ยอดคงเหลือ: ${targetUser.balance.toFixed(1)} บาท` 
                                };
                            }
                        }
                    }
                }

                // ==========================================
// PART 3: แอดมินจัดขาให้ผู้เล่น (`ใส่ขา [ขา] [ผู้เล่น]`)
// ==========================================
else if (originalMsg.startsWith('@') || originalMsg.startsWith('@')) {
    if (!isAdmin) {
        replyMessageObject = { type: 'text', text: `❌ คุณไม่ใช่แอดมิน!` };
    } else {
        // แยกคำสั่ง เช่น "ใส่ขา 1 2 ต้น" -> ขา: [1, 2], ผู้เล่น: "ต้น"
        let parts = originalMsg.replace('@', '').replace('@', '').trim().split(/\s+/);
        let legsToAssign = [];
        let userKeyword = "";

        for (let p of parts) {
            if (!isNaN(p)) {
                legsToAssign.push(parseInt(p));
            } else {
                userKeyword = p;
            }
        }

        if (legsToAssign.length > 1 && !userKeyword) {
            userKeyword = legsToAssign.pop().toString();
        }

        let targetUserId = findUserIdByKeyword(userKeyword);
        let targetUser = targetUserId ? usersWallets[targetUserId] : null;

        if (!targetUser || legsToAssign.length === 0) {
            replyMessageObject = { 
                type: 'text', 
                text: `👑 [แอดมิน] ❌ รูปแบบไม่ถูกต้อง!\n📌 ตัวอย่างระบุชื่อ: **ใส่ขา 1 2 ต้น**\n📌 ตัวอย่างระบุเลขสมาชิก: **ใส่ขา 1 2 2**` 
            };
        } else {
            let invalidLegs = [];
            let validLegs = [];

            for (let leg of legsToAssign) {
                if (leg < 1 || leg > TOTAL_LEGS) {
                    invalidLegs.push(leg);
                } else {
                    validLegs.push(leg);
                }
            }

            if (invalidLegs.length > 0) {
                replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ ขา [${invalidLegs.join(', ')}] ไม่ถูกต้อง (ระบบมีขา 1 ถึง ${TOTAL_LEGS})` };
            } else {
                // บันทึกขาเตรียมไว้ใน occupiedLegs (ยังไม่หักเงินค้ำ จนกว่าจะสั่งเปิดรอบ 'o')
                validLegs.forEach(k => {
                    occupiedLegs[k] = targetUserId;
                });

                let tName = getUserDisplayName(targetUser);
                replyMessageObject = { 
                    type: 'text', 
                    text: `👑 [แอดมิน - จัดขาเรียบร้อย]\n👤 ผู้เล่น: **[${tName}]**\n🎲 ขาที่จัดไว้: **[${validLegs.join(', ')}]**\n\n📌 *ผูกขาเรียบร้อย! พิมพ์ 'o' เมื่อต้องการเปิดรอบและหักเงินค้ำ*` 
                };
            }
        }
    }
}

                // ==========================================
// PART 4: เปิดรอบ (o) / ปิดรอบ (x)
// ==========================================
else if (userMsg === 'o') {
    if (!isAdmin) {
        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
    } else {
        isRoundOpen = true; 
        roundBets = {}; 
        pendingResults = null;

        // 1. นับจำนวนขาที่มีผู้เล่นอยู่จริง
        let activeLegs = [];
        for (let leg = 1; leg <= TOTAL_LEGS; leg++) {
            if (occupiedLegs[leg]) {
                activeLegs.push(leg);
            }
        }

        let N = activeLegs.length;

        if (N < 2) {
            replyMessageObject = { 
                type: 'text', 
                text: `🟢 [เปิดรับเดิมพันรอบใหม่]\n------------------------\n⚠️ **ขาที่มีคนเล่นน้อยเกินไป (มีแค่ ${N} ขา)**\n📌 *กรุณาใช้คำสั่ง 'ใส่ขา' เพิ่มผู้เล่นอย่างน้อย 2 ขาขึ้นไปครับ*` 
            };
        } else {
            // คำนวณเงินค้ำประกันต่อขา: (N - 1) * 2 * ราคา
            let requiredHoldingPerLeg = (N - 1) * 2 * defaultBetPrice;

            // จัดกลุ่มขาตามผู้เล่น
            let playerLegs = {};
            for (let leg of activeLegs) {
                let uid = occupiedLegs[leg];
                if (!playerLegs[uid]) playerLegs[uid] = [];
                playerLegs[uid].push(leg);
            }

            let successReport = "";
            let failedReport = "";

            // วนตรวจสอบเงินค้ำประกันของผู้เล่นแต่ละคน
            for (let uid in playerLegs) {
                let pUser = usersWallets[uid];
                let legs = playerLegs[uid];
                let totalHoldingNeeded = requiredHoldingPerLeg * legs.length;

                if (pUser && pUser.balance >= totalHoldingNeeded && !pUser.isLockWithdraw) {
                    // เงินพอ -> หักค้ำประกัน และ บันทึกโพย
                    pUser.balance -= totalHoldingNeeded;
                    roundBets[uid] = {
                        betPerKha: defaultBetPrice,
                        holding: totalHoldingNeeded,
                        khasDetails: {}
                    };
                    legs.forEach(k => {
                        roundBets[uid].khasDetails[k] = true;
                    });
                    successReport += `▪️ [${getUserDisplayName(pUser)}]: ขา [${legs.join(', ')}] (ค้ำ ${totalHoldingNeeded} บ.)\n`;
                } else {
                    // เงินไม่พอ หรือโดนล็อกถอน -> ถอนขาออกชั่วคราวในรอบนี้
                    legs.forEach(k => {
                        delete occupiedLegs[k]; // ตัดขานี้ออกจากรอบนี้
                    });
                    let currentBal = pUser ? pUser.balance.toFixed(1) : 0;
                    failedReport += `⚠️ [${getUserDisplayName(pUser)}]: เงินไม่พอค้ำประกัน (มี ${currentBal} / ขาด ${totalHoldingNeeded} บ.) ❌ **ตัดขารอบนี้ออก**\n`;
                }
            }

            let reportText = `🟢 [เปิดรับเดิมพันรอบใหม่สำเร็จ]\n------------------------\n🎲 ขาที่มีคนเล่นจริง: **${N} ขา**\n💵 ราคาเดิมพัน: **ขาละ ${defaultBetPrice} บาท**\n🔒 เงินค้ำประกันต่อขา: **${requiredHoldingPerLeg} บาท**\n\n📋 **[รายการผู้เล่นในรอบนี้]**:\n${successReport}`;

            if (failedReport !== "") {
                reportText += `\n🚨 **[สมาชิกเงินไม่พอ - ไม่นับผลรอบนี้]**:\n${failedReport}`;
            }

            replyMessageObject = { type: 'text', text: reportText };
        }
    }
}
                // ==========================================
                // PART 5: ตรวจผลไพ่ (>) / คิดเงิน (ok)
                // ==========================================
                else if (originalMsg.startsWith('>')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        let rawContent = originalMsg.substring(1).trim();
                        let rawTokens = rawContent.split(/[\s\n]+/);

                        let parsedList = [];
                        for (let token of rawTokens) {
                            if (token.trim() !== '') {
                                parsedList.push(parseCardValue(token));
                            }
                        }

                        pendingResults = { parsedList };
                        let previewText = `🐓 [ตรวจผลคะแนนตีไก่]\n------------------------\n`;
                        
                        for (let i = 0; i < parsedList.length; i++) {
                            let legNum = i + 1;
                            if (legNum > TOTAL_LEGS) break;

                            let cardRes = parsedList[i];
                            let ownerUser = occupiedLegs[legNum] ? usersWallets[occupiedLegs[legNum]] : null;
                            let owner = ownerUser ? getUserDisplayName(ownerUser) : "ไม่มีคนเล่น";
                            let dengStr = cardRes.deng > 1 ? ` (${cardRes.deng} เด้ง)` : '';
                            previewText += `🔹 ขา ${legNum} (${owner}): **${cardRes.score} แต้ม**${dengStr}\n`;
                        }

                        replyMessageObject = { type: 'text', text: previewText + `\n📢 หากถูกต้องพิมพ์ **OK** เพื่อคิดเงิน` };
                    }
                }
                else if (userMsg === 'ok') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else if (!pendingResults) {
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ⚠️ ไม่มีผลคะแนนค้างในระบบ` };
                    } else {
                        let { parsedList } = pendingResults;
                        let parsedCards = {};
                        
                        // 1. หาแต้มสูงสุดเฉพาะขาที่มีผู้เล่นจริง
                        let maxScoreInRound = -1;
                        for (let i = 0; i < parsedList.length; i++) {
                            let legNum = i + 1;
                            if (occupiedLegs[legNum]) {
                                parsedCards[legNum] = parsedList[i];
                                if (parsedList[i].score > maxScoreInRound) {
                                    maxScoreInRound = parsedList[i].score;
                                }
                            }
                        }

                        let summaryText = `📊 [สรุปผลคิดเงินป๊อกเด้งตีไก่]\n------------------------\n`;

                        // 2. คำนวณผลได้เสียของแต่ละคน
                        for (let uid in roundBets) {
                            let savedBet = roundBets[uid];
                            let pUser = usersWallets[uid];
                            let pName = getUserDisplayName(pUser);
                            let totalNetWinLoss = 0;
                            let legReportText = "";

                            let myLegs = Object.keys(savedBet.khasDetails).map(Number);

                            for (let myLeg of myLegs) {
                                let myCard = parsedCards[myLeg];
                                if (!myCard) continue;

                                let legWinLoss = 0;

                                // ชนกับขาผู้เล่นคนอื่นบนกระดาน
                                for (let oppLeg in occupiedLegs) {
                                    oppLeg = parseInt(oppLeg);
                                    if (myLeg === oppLeg) continue;

                                    let oppCard = parsedCards[oppLeg];
                                    if (!oppCard) continue;

                                    let bet = defaultBetPrice;

                                    if (myCard.score > oppCard.score) {
                                        let winAmt = bet * myCard.deng;
                                        let profit = winAmt;

                                        // 💡 [กฎต๋งใหม่]: คิดค่าน้ำเฉพาะคนแต้มสูงสุดประจำรอบ
                                        if (myCard.score === maxScoreInRound) {
                                            let rakeRate = (myCard.deng >= 2) ? 0.20 : 0.10; // 2 เด้งขึ้นไปหัก 20%, 1 เด้งหัก 10%
                                            profit = winAmt * (1 - rakeRate);
                                        }

                                        legWinLoss += profit;
                                    } else if (myCard.score < oppCard.score) {
                                        let loseAmt = bet * oppCard.deng;
                                        legWinLoss -= loseAmt;
                                    }
                                }

                                totalNetWinLoss += legWinLoss;
                                let sign = legWinLoss >= 0 ? `+${legWinLoss.toFixed(1)}` : `${legWinLoss.toFixed(1)}`;
                                legReportText += `    ▪️ ขา ${myLeg} (${myCard.score} แต้ม): ${sign} บ.\n`;
                            }

                            let finalReturn = savedBet.holding + totalNetWinLoss;
                            pUser.balance += finalReturn;

                            let overallSign = totalNetWinLoss >= 0 ? `+${totalNetWinLoss.toFixed(1)}` : `${totalNetWinLoss.toFixed(1)}`;
                            summaryText += `👤 **[${pName}]**:\n${legReportText}    🏆 ผลรวมรอบนี้: **${overallSign} บาท**\n    💳 ยอดเงินคงเหลือล่าสุด: ${pUser.balance.toFixed(1)} บาท\n------------------------\n`;
                        }

                        // 3. 🚨 เช็กผู้เล่นที่ยอดเงินไม่พอเล่นในรอบถัดไป (ค้ำประกันอย่างน้อย 1 ขา)
                        let requiredHoldingForOneLeg = (TOTAL_LEGS - 1) * 2 * defaultBetPrice;
                        let lowBalanceReport = "";

                        for (let uid in usersWallets) {
                            let u = usersWallets[uid];
                            if (u.balance < requiredHoldingForOneLeg) {
                                lowBalanceReport += `⚠️ [${getUserDisplayName(u)}]: คงเหลือ ${u.balance.toFixed(1)} บ. (ขาดอีก ${(requiredHoldingForOneLeg - u.balance).toFixed(1)} บ.)\n`;
                            }
                        }

                        if (lowBalanceReport !== "") {
                            summaryText += `\n🚨 **[เเจ้งเตือนสมาชิกยอดเงินไม่พอค้ำประกันรอบถัดไป]**:\n` + lowBalanceReport;
                        }

                        replyMessageObject = { type: 'text', text: summaryText + `\n✨ เคลียร์ยอดเรียบร้อย! พิมพ์ o เพื่อเปิดรอบถัดไป` };

                        // 🔄 คืนค่ากระดานค้างไว้สำหรับรอบถัดไป (ขาล็อค)
                        isRoundOpen = false;
                        pendingResults = null; 
                        // *หมายเหตุ: ไม่ต้องสั่ง occupiedLegs = {} เพื่อให้ขาล็อคค้างไว้ให้แอดมินเปิดรอบหน้าได้เลย*
                        
                        // 🔄 เคลียร์ข้อมูลรอบปัจจุบัน
                        isRoundOpen = false;
                        occupiedLegs = {};
                        roundBets = {}; 
                        pendingResults = null; 
                    }
                }
                else if (userMsg === 'no') {
                    if (isAdmin) {
                        pendingResults = null; 
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] 🛑 ยกเลิกผลคะแนนแล้ว ส่งผลคะแนนใหม่ได้เลย` };
                    }
                }
            }

            // ส่งข้อความตอบกลับไปยัง LINE
            if (replyMessageObject) {
                try {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken: replyToken,
                            messages: [replyMessageObject]
                        })
                    });
                } catch (err) {
                    console.error('Error sending message:', err);
                }
            }
        }
    }
    res.sendStatus(200);
});

// ==========================================
// 📌 4. กำหนด Port สำหรับ Render
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
