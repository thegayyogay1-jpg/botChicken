const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 📌 1. ตั้งค่าตัวแปรระบบและ Global Variables
// ==========================================
const ADMIN_LIST = ['U1234567890abcdef1234567890abcdef']; // 👈 ใส่ LINE User ID ของแอดมิน
const COMMISSION_RATE = 0.05; // ค่าน้ำ 5% (ถ้าไม่ต้องการให้ใส่ 0)

let usersWallets = {};
let nextMemberId = 1;

// ตัวแปรควบคุมรอบการเล่น
let isRoundOpen = false;
let maxLegsCount = 0;      // จำนวนขาทั้งหมดในรอบนี้
let currentBetPrice = 0;   // ราคาต่อขาในรอบนี้
let occupiedLegs = {};     // เก็บสถานะขา { 1: userId, 2: userId, ... }
let roundBets = {};        // เก็บรายละเอียดการแทงของแต่ละคน
let pendingResults = null;

// ==========================================
// 📌 2. ฟังก์ชันคำนวณไพ่ป๊อกเด้ง (parseCard)
// ==========================================
function parseCard(cardStr) {
    if (!cardStr) return { score: 0, deng: 1 };
    let str = cardStr.trim().toLowerCase();
    
    let deng = 1;
    if (str.startsWith('d')) {
        deng = 2;
        str = str.substring(1);
    } else if (str.startsWith('k')) {
        deng = 3;
        str = str.substring(1);
    }

    let score = 0;
    if (str.length === 2) {
        let c1 = str[0];
        let c2 = str[1];
        let val1 = isNaN(c1) ? 0 : parseInt(c1);
        let val2 = isNaN(c2) ? 0 : parseInt(c2);
        score = (val1 + val2) % 10;
    } else if (str.length === 1) {
        score = isNaN(str) ? 0 : parseInt(str);
    }

    return { score, deng };
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
                    replyMessageObject = { type: 'text', text: "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ" };
                } else {
                    usersWallets = {}; nextMemberId = 1; isRoundOpen = false; 
                    maxLegsCount = 0; currentBetPrice = 0; occupiedLegs = {}; roundBets = {}; pendingResults = null;
                    replyMessageObject = { type: 'text', text: "👑 [แอดมิน] ♻️ ล้างระบบสมาชิกและกระดานเรียบร้อยแล้วครับ!" };
                }
            }
            // ระบบสมาชิก + คำสั่งอื่นๆ
            else {
                if (!usersWallets[userId]) {
                    usersWallets[userId] = { 
                        memberNumber: nextMemberId,
                        memberTitle: `สมาชิกที่ ${nextMemberId}`,
                        name: "ผู้เล่นทั่วไป", 
                        balance: 0,
                        isLockWithdraw: false,
                        pendingWithdrawAmount: 0
                    };
                    nextMemberId++;
                }
                
                const user = usersWallets[userId];
                const mentionText = `👤 ${user.memberTitle} `;

                // ดึงชื่อเล่นชั่วคราว
                if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                    let firstMention = event.message.mention.mentions[0];
                    if (firstMention.userId === userId) {
                        let parts = originalMsg.split(/\s+/);
                        let rawName = parts.find(p => p.includes('@'));
                        if (rawName) user.name = rawName.replace('@', '').trim();
                    }
                }

                // ==========================================
                // PART 1: ระบบเติมเงิน / ถอนเงิน / เช็กยอด
                // ==========================================
                if (originalMsg.startsWith('เติม')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        let targetUserId = null;
                        let amount = 0;
                        const moneyMatch = originalMsg.match(/\d+$/);
                        if (moneyMatch) amount = parseInt(moneyMatch[0]);

                        let cleanText = originalMsg.replace('เติม', '').trim();
                        if (moneyMatch) cleanText = cleanText.substring(0, cleanText.lastIndexOf(moneyMatch[0])).trim();
                        let searchKeyword = cleanText.replace('@', '').trim().toLowerCase().replace(/\s+/g, '');

                        if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                            targetUserId = event.message.mention.mentions[0].userId;
                        } else if (searchKeyword) {
                            for (let uid in usersWallets) {
                                let u = usersWallets[uid];
                                if (u.memberTitle.toLowerCase().replace(/\s+/g, '') === searchKeyword || u.memberNumber.toString() === searchKeyword || u.name.toLowerCase().replace(/\s+/g, '').includes(searchKeyword)) {
                                    targetUserId = uid;
                                    break;
                                }
                            }
                        }

                        if (!targetUserId || isNaN(amount) || amount <= 0) {
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ เติมเงินไม่สำเร็จ\n📌 รูปแบบ: **เติม [เลขสมาชิก] [จำนวนเงิน]**` };
                        } else {
                            usersWallets[targetUserId].balance += amount;
                            let tUser = usersWallets[targetUserId];
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ✅ เติมเงินสำเร็จ! +${amount} บาท ให้แก่ ${tUser.memberTitle}\n💰 ยอดเงินคงเหลือ: ${tUser.balance} บาท` };
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
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ ยอดเงินในระบบไม่พอ (มีอยู่ ${user.balance} บ.)` };
                            } else {
                                user.isLockWithdraw = true;
                                user.pendingWithdrawAmount = amount;
                                replyMessageObject = {
                                    type: 'text',
                                    text: `🔔 [ระบบรับเรื่องแจ้งถอน]\n👤 ${user.memberTitle}\n💰 ยอดที่ต้องการถอน: **${amount}** บาท\n🔒 Status: ล็อกกระเป๋าชั่วคราว`
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
                        let memberNum = parts[1] ? parseInt(parts[1]) : 0;
                        let targetUserId = null;

                        for (let uid in usersWallets) {
                            if (usersWallets[uid].memberNumber === memberNum) {
                                targetUserId = uid;
                                break;
                            }
                        }

                        if (!targetUserId) {
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ ไม่พบสมาชิกเลขนี้` };
                        } else {
                            const targetUser = usersWallets[targetUserId];
                            if (!targetUser.isLockWithdraw || targetUser.pendingWithdrawAmount <= 0) {
                                replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ สมาชิกไม่ได้แจ้งถอนค้างไว้` };
                            } else {
                                let amount = targetUser.pendingWithdrawAmount;
                                targetUser.balance -= amount;
                                targetUser.isLockWithdraw = false;
                                targetUser.pendingWithdrawAmount = 0;
                                replyMessageObject = { 
                                    type: 'text', 
                                    text: `👑 [แอดมิน] ✅ อนุมัติถอนสำเร็จ!\n👤 สมาชิกที่ ${targetUser.memberNumber}\n📉 หักยอด: -${amount} บาท\n💰 ยอดคงเหลือ: ${targetUser.balance} บาท` 
                                };
                            }
                        }
                    }
                }
                else if (userMsg === 'c') {
                    replyMessageObject = { type: 'text', text: `👤 ${user.memberTitle}\n💰 ยอดเงินคงเหลือ: ${user.balance} บาท` };
                }

                // ==========================================
                // PART 2: แอดมินเปิดรอบ / กำหนดขา และราคา
                // ==========================================
                // คำสั่งเช่น: "เปิด 8 10", "เพิ่ม 8 ราคา 10", "o"
                else if (userMsg.startsWith('เปิด') || userMsg.startsWith('เพิ่ม') || userMsg === 'o') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        let matches = originalMsg.match(/\d+/g);
                        if (matches && matches.length >= 2) {
                            maxLegsCount = parseInt(matches[0]);
                            currentBetPrice = parseInt(matches[1]);
                        } else if (maxLegsCount === 0 || currentBetPrice === 0) {
                            // ค่าเริ่มต้นกรณีพิมพ์แค่ "o" แล้วยังไม่ได้ตั้งค่า
                            maxLegsCount = 8;
                            currentBetPrice = 10;
                        }

                        isRoundOpen = true; 
                        occupiedLegs = {}; 
                        roundBets = {}; 
                        pendingResults = null;

                        let requiredHolding = (maxLegsCount - 1) * 2 * currentBetPrice;

                        replyMessageObject = { 
                            type: 'text', 
                            text: `🟢 [ระบบตีไก่ - เปิดรับเดิมพัน]\n------------------------\n🎲 ขาทั้งหมด: **1 ถึง ${maxLegsCount}**\n💵 ราคาเดิมพัน: **ขาละ ${currentBetPrice} บาท**\n🔒 ต้องมีเงินค้ำประกัน: **${requiredHolding} บาท**\n\n📌 *พิมพ์เลือกขาที่ต้องการได้เลย เช่น: 1, 2, 5 (ใครไวกว่าได้ก่อน!)*` 
                        };
                    }
                }
                else if (userMsg === 'x') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        if (!isRoundOpen) {
                            replyMessageObject = { type: 'text', text: "⚠️ รอบเดิมพันปิดอยู่แล้ว" };
                        } else {
                            isRoundOpen = false;
                            let summary = `🔴 [ระบบตีไก่] ปิดรับเดิมพันแล้ว!\n🎲 ขาทั้งหมด: ${maxLegsCount} ขา (ขาละ ${currentBetPrice} บ.)\n📋 [รายการขาที่มีผู้ลงแข่งขัน]:\n`;
                            let hasData = false;
                            
                            for (let leg = 1; leg <= maxLegsCount; leg++) {
                                if (occupiedLegs[leg]) {
                                    let u = usersWallets[occupiedLegs[leg]];
                                    summary += `▪️ ขา ${leg}: ${u.memberTitle}\n`;
                                    hasData = true;
                                } else {
                                    summary += `▫️ ขา ${leg}: [ว่าง]\n`;
                                }
                            }
                            
                            if (!hasData) summary += "❌ ไม่มีใครลงเดิมพันในรอบนี้\n";
                            replyMessageObject = { type: 'text', text: summary + `\n⏳ รอแอดมินสรุปผลไพ่ เช่น 'ผล: 53,d8,11,k9'` };
                        }
                    }
                }
                else if (userMsg === 'r') {
                    if (user.isLockWithdraw) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ กระเป๋าโดนล็อก` };
                    } else if (!isRoundOpen) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ ปิดรอบไปแล้ว ยกเลิกไม่ได้` };
                    } else if (!roundBets[userId]) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่มีโพยในรอบนี้` };
                    } else {
                        const savedBet = roundBets[userId];
                        
                        // เคลียร์ขาออกจากกระดาน
                        for (let leg in savedBet.khasDetails) {
                            delete occupiedLegs[leg];
                        }

                        user.balance += savedBet.holding; 
                        delete roundBets[userId]; 
                        replyMessageObject = { type: 'text', text: `${mentionText} 🔄 คืนโพยและยกเลิกขาเรียบร้อย!\n💰 ยอดเงินคงเหลือ: ${user.balance} บาท` };
                    }
                }

                // ==========================================
                // PART 3: ตรวจผลไพ่ / คิดเงิน (คิดเฉพาะขาที่มีคน)
                // ==========================================
                else if (originalMsg.startsWith('ผล:') || originalMsg.startsWith('ผล ')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        const resultStr = originalMsg.replace(/^ผล:\s*|^ผล\s+/i, '');
                        const results = resultStr.split(','); 

                        pendingResults = { results };
                        let previewText = `🐓 [ตรวจผลไพ่ระบบตีไก่]\n------------------------\n`;
                        
                        for (let i = 0; i < results.length; i++) {
                            let legNum = i + 1;
                            let cardRes = parseCard(results[i]);
                            let owner = occupiedLegs[legNum] ? usersWallets[occupiedLegs[legNum]].memberTitle : "ไม่มีผู้เล่น";
                            previewText += `🔹 ขา ${legNum} (${owner}): ${cardRes.score} แต้ม (${cardRes.deng} เด้ง)\n`;
                        }

                        replyMessageObject = { type: 'text', text: previewText + `\n📢 หากถูกต้องพิมพ์ **OK** เพื่อคิดเงินชนไพ่ทุกคู่` };
                    }
                }
                else if (userMsg === 'ok') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else if (!pendingResults) {
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ⚠️ ไม่มีผลไพ่ค้างในระบบ` };
                    } else {
                        let { results } = pendingResults;
                        let parsedCards = {};
                        for (let i = 0; i < results.length; i++) {
                            parsedCards[i + 1] = parseCard(results[i]);
                        }

                        let summaryText = `📊 [สรุปผลคิดเงินป๊อกเด้งตีไก่]\n------------------------\n`;

                        for (let uid in roundBets) {
                            let savedBet = roundBets[uid];
                            let pUser = usersWallets[uid];
                            let totalNetWinLoss = 0;
                            let legReportText = "";

                            let myLegs = Object.keys(savedBet.khasDetails).map(Number);

                            for (let myLeg of myLegs) {
                                let myCard = parsedCards[myLeg];
                                if (!myCard) continue;

                                let legWinLoss = 0;

                                // ชนไพ่กับขาอื่นที่มีคนลงเล่นเท่านั้น
                                for (let oppLeg in occupiedLegs) {
                                    oppLeg = parseInt(oppLeg);
                                    if (myLeg === oppLeg) continue; // ไม่ชนขาตัวเอง

                                    let oppCard = parsedCards[oppLeg];
                                    if (!oppCard) continue;

                                    let bet = currentBetPrice;

                                    if (myCard.score > oppCard.score) {
                                        let winAmt = bet * myCard.deng;
                                        let profit = winAmt * (1 - COMMISSION_RATE);
                                        legWinLoss += profit;
                                    } else if (myCard.score < oppCard.score) {
                                        let loseAmt = bet * oppCard.deng;
                                        legWinLoss -= loseAmt;
                                    }
                                }

                                totalNetWinLoss += legWinLoss;
                                let sign = legWinLoss >= 0 ? `+${legWinLoss.toFixed(0)}` : `${legWinLoss.toFixed(0)}`;
                                legReportText += `    ▪️ ขา ${myLeg} (${myCard.score} แต้ม): ${sign} บ.\n`;
                            }

                            let finalReturn = savedBet.holding + totalNetWinLoss;
                            pUser.balance += finalReturn;

                            let overallSign = totalNetWinLoss >= 0 ? `+${totalNetWinLoss.toFixed(0)}` : `${totalNetWinLoss.toFixed(0)}`;
                            summaryText += `👤 ${pUser.memberTitle}:\n${legReportText}    🏆 ผลรวมรอบนี้: **${overallSign} บาท**\n    💳 ยอดเงินคงเหลือล่าสุด: ${pUser.balance} บาท\n------------------------\n`;
                        }

                        replyMessageObject = { type: 'text', text: summaryText + `✨ เคลียร์ยอดเรียบร้อย! ขาถูกรีเซ็ตแล้ว แอดมินเปิดรอบใหม่ได้เลย` };
                        
                        // 🔄 เคลียร์ข้อมูลขาทั้งหมด เพื่อให้รอบถัดไปแย่งเลือกขาใหม่
                        isRoundOpen = false;
                        occupiedLegs = {};
                        roundBets = {}; 
                        pendingResults = null; 
                    }
                }
                else if (userMsg === 'no') {
                    if (isAdmin) {
                        pendingResults = null; 
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] 🛑 ยกเลิกผลไพ่แล้ว สามารถส่งผลไพ่ใหม่ได้เลย` };
                    }
                }

                // ==========================================
                // PART 4: ผู้เล่นส่งคำสั่งเลือกขา (เช่น "1", "2,3", "ขา 1")
                // ==========================================
                else {
                    // ตรวจหาตัวเลขขาที่ผู้เล่นพิมพ์เข้ามา
                    let requestedLegs = originalMsg.match(/\d+/g);
                    if (requestedLegs && requestedLegs.length > 0) {
                        requestedLegs = requestedLegs.map(Number);

                        if (user.isLockWithdraw) {
                            replyMessageObject = { type: 'text', text: `${mentionText} ❌ ไม่สามารถแทงได้! กระเป๋าถูกล็อกชั่วคราว` };
                        } else if (!isRoundOpen) {
                            replyMessageObject = { type: 'text', text: `${mentionText} ❌ ยังไม่เปิดรอบ!` };
                        } else {
                            let invalidLegs = [];
                            let alreadyOccupiedLegs = [];
                            let validLegsToTake = [];

                            for (let leg of requestedLegs) {
                                if (leg < 1 || leg > maxLegsCount) {
                                    invalidLegs.push(leg);
                                } else if (occupiedLegs[leg] && occupiedLegs[leg] !== userId) {
                                    alreadyOccupiedLegs.push(leg);
                                } else if (!occupiedLegs[leg]) {
                                    validLegsToTake.push(leg);
                                }
                            }

                            if (invalidLegs.length > 0) {
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ ขา [${invalidLegs.join(', ')}] ไม่มีในระบบ! (รอบนี้เปิด 1 ถึง ${maxLegsCount} ขา)` };
                            } else if (alreadyOccupiedLegs.length > 0) {
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ ขา [${alreadyOccupiedLegs.join(', ')}] มีคนลงแล้ว! ไม่สามารถลงซ้ำได้` };
                            } else if (validLegsToTake.length > 0) {
                                // 📐 สูตรเงินค้ำประกัน: (ขาทั้งหมด - 1) * 2 * ราคาต่อขา
                                let requiredHoldingPerLeg = (maxLegsCount - 1) * 2 * currentBetPrice;
                                let totalRequiredHolding = requiredHoldingPerLeg * validLegsToTake.length;

                                if (user.balance < totalRequiredHolding) {
                                    replyMessageObject = { 
                                        type: 'text', 
                                        text: `${mentionText} ❌ ยอดเงินไม่พอค้ำประกัน!\n💡 ต้องมีเงินค้ำประกันอย่างน้อย **${totalRequiredHolding} บาท** (ขาละ ${requiredHoldingPerLeg} บาท)\n💳 ยอดเงินของคุณคงเหลือ: ${user.balance} บาท` 
                                    };
                                } else {
                                    if (!roundBets[userId]) {
                                        roundBets[userId] = { betPerKha: currentBetPrice, holding: 0, khasDetails: {} };
                                    }

                                    validLegsToTake.forEach(k => {
                                        occupiedLegs[k] = userId;
                                        roundBets[userId].khasDetails[k] = true;
                                    });

                                    roundBets[userId].holding += totalRequiredHolding;
                                    user.balance -= totalRequiredHolding;

                                    replyMessageObject = { 
                                        type: 'text', 
                                        text: `${mentionText} 🐓 [ลงขาสำเร็จ]\n📌 ขาที่เลือก: **[${validLegsToTake.join(', ')}]**\n💵 ราคาเดิมพัน: ขาละ ${currentBetPrice} บ.\n🔒 หักค้ำประกัน: ${totalRequiredHolding} บ.\n💳 ยอดเงินคงเหลือ: ${user.balance} บาท` 
                                    };
                                }
                            }
                        }
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
