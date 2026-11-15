/**
 * Pre-cut master Angela clips seed table for synchronous sample-accurate audio resolution.
 * Lossless 48kHz WAV cuts covering all 35 primary documentary soundbites + multi-part arc.
 */

export interface PreCutClip {
  id: string;
  filename?: string;
  title: string;
  quote?: string;
  space_tag?: string;
  space_title?: string;
  timestamp?: string;
  url: string;
  duration: number;
  speaker?: string;
  quote_id?: string;
  category?: string;
}

export const ANGELA_MASTER_CUTS: PreCutClip[] = [
  {
    "id": "angela_clip_01",
    "filename": "01_Evidence_Speaks_For_Itself.wav",
    "title": "01 Evidence Speaks For Itself",
    "quote": "Evidence speaks for itself...",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "00:37",
    "url": "/clips/angela/01_Evidence_Speaks_For_Itself.wav",
    "duration": 4.86,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_02",
    "filename": "02_Has_Address_Phone_Personal_Info.wav",
    "title": "02 Has Address Phone Personal Info",
    "quote": "I already have their address and phone number and personal information, and I'll slap them with the lawsuit so fast.",
    "space_tag": "20260217_1vAxRvZrEPaxl",
    "space_title": "Haunted Hump Day",
    "timestamp": "12:51:21",
    "url": "/clips/angela/02_Has_Address_Phone_Personal_Info.wav",
    "duration": 7.34,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_03",
    "filename": "03_Always_Do_That_Before_I_Talk.wav",
    "title": "03 Always Do That Before I Talk",
    "quote": "I always do that before I talk to someone.",
    "space_tag": "20260217_1vAxRvZrEPaxl",
    "space_title": "Haunted Hump Day",
    "timestamp": "12:51:36",
    "url": "/clips/angela/03_Always_Do_That_Before_I_Talk.wav",
    "duration": 2.3,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_04",
    "filename": "04_Dont_Expose_Unless_I_Need_To.wav",
    "title": "04 Dont Expose Unless I Need To",
    "quote": "I don't ever expose it unless I need to...",
    "space_tag": "20260217_1vAxRvZrEPaxl",
    "space_title": "Haunted Hump Day",
    "timestamp": "12:51:36",
    "url": "/clips/angela/04_Dont_Expose_Unless_I_Need_To.wav",
    "duration": 6.36,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_05",
    "filename": "05_Do_That_For_Fun.wav",
    "title": "05 Do That For Fun",
    "quote": "Oh, yeah. I do that for fun. I know that's probably bad...",
    "space_tag": "20260217_1vAxRvZrEPaxl",
    "space_title": "Haunted Hump Day",
    "timestamp": "12:51:49",
    "url": "/clips/angela/05_Do_That_For_Fun.wav",
    "duration": 4.52,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_03_05",
    "filename": "03_05_Always_Do_That_For_Fun.wav",
    "title": "03-05 Always Do That For Fun (Full Arc)",
    "quote": "Oh, I got it. I always do that before I talk to someone. Yeah. But I don't ever expose it unless I need to. I just have it so I can get to my attorney if I needed to... Oh, yeah. I do that for fun. I know that's probably bad, but, like, that's what I do on TikTok.",
    "space_tag": "20260217_1vAxRvZrEPaxl",
    "space_title": "Haunted Hump Day",
    "timestamp": "12:51:36",
    "url": "/clips/angela/03_05_Always_Do_That_For_Fun.wav",
    "duration": 13.18,
    "speaker": "Angela Maggard",
    "category": "Retaliation & Disclosure"
  },
  {
    "id": "angela_clip_06",
    "filename": "06_Send_People_To_Watch_You.wav",
    "title": "06 Send People To Watch You",
    "quote": "I'll send people in the community that I know in real life to watch you talk shit about me...",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "01:52:22",
    "url": "/clips/angela/06_Send_People_To_Watch_You.wav",
    "duration": 6.88,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_07",
    "filename": "07_Play_Dumb_For_Months.wav",
    "title": "07 Play Dumb For Months",
    "quote": "...and then I'll play dumb. I'll do that for months.",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "01:52:22",
    "url": "/clips/angela/07_Play_Dumb_For_Months.wav",
    "duration": 3.74,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_08",
    "filename": "08_Doxxed_People_Admission.wav",
    "title": "08 Doxxed People Admission",
    "quote": "I've doxed people. Let's not even sit here and beat around the motherfucking bush.",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "12:56 segment",
    "url": "/clips/angela/08_Doxxed_People_Admission.wav",
    "duration": 5.5,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_09",
    "filename": "09_Doxxed_Group_Leader_Front_Door.wav",
    "title": "09 Doxxed Group Leader Front Door",
    "quote": "So, yes, I doxed the leader of that racist group chat... I sent him...the photo of his front door...",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "12:56 segment",
    "url": "/clips/angela/09_Doxxed_Group_Leader_Front_Door.wav",
    "duration": 7.72,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_10",
    "filename": "10_Doxxing_Definition_Older.wav",
    "title": "10 Doxxing Definition Older",
    "quote": "Angela's earlier explanation of what she considers doxxing.",
    "space_tag": "20260217_1mnGeAPMdvEGX",
    "space_title": "LiVE Cambian interviews TupacabraRedpandakoala UFO Shane",
    "timestamp": "46:11",
    "url": "/clips/angela/10_Doxxing_Definition_Older.wav",
    "duration": 25.74,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_11",
    "filename": "11_Petty_Retired_Mean_Girl.wav",
    "title": "11 Petty Retired Mean Girl",
    "quote": "I am a very petty individual... I'm a retired mean girl.",
    "space_tag": "20260217_1lPKqbPREoeGb",
    "space_title": "Cult Signups",
    "timestamp": "02:50:14",
    "url": "/clips/angela/11_Petty_Retired_Mean_Girl.wav",
    "duration": 6.8,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_12",
    "filename": "12_Not_Holding_Punches.wav",
    "title": "12 Not Holding Punches",
    "quote": "If people make me come back to character, I'm not holding any punches back.",
    "space_tag": "20260217_1lPKqbPREoeGb",
    "space_title": "Cult Signups",
    "timestamp": "02:50:14",
    "url": "/clips/angela/12_Not_Holding_Punches.wav",
    "duration": 8.08,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_13",
    "filename": "13_Take_It_Too_Far.wav",
    "title": "13 Take It Too Far",
    "quote": "Don't cry about it later when we take it too damn far...",
    "space_tag": "20260217_1lPKqbPREoeGb",
    "space_title": "Cult Signups",
    "timestamp": "02:52:28",
    "url": "/clips/angela/13_Take_It_Too_Far.wav",
    "duration": 6.4,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_14",
    "filename": "14_Zero_To_100_No_Doubling_Back.wav",
    "title": "14 Zero To 100 No Doubling Back",
    "quote": "I go zero to a 100. There's no doubling back...",
    "space_tag": "20260217_1lPKqbPREoeGb",
    "space_title": "Cult Signups",
    "timestamp": "02:52:28",
    "url": "/clips/angela/14_Zero_To_100_No_Doubling_Back.wav",
    "duration": 5.8,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_15",
    "filename": "15_Wrap_You_Up_In_Lawsuits.wav",
    "title": "15 Wrap You Up In Lawsuits",
    "quote": "I'll wrap you up in lawsuits... three to four years... You're gonna be paying out of pocket. I'm not.",
    "space_tag": "20260217_1lPKqbPREoeGb",
    "space_title": "Cult Signups",
    "timestamp": "02:52:28",
    "url": "/clips/angela/15_Wrap_You_Up_In_Lawsuits.wav",
    "duration": 8.02,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_16",
    "filename": "16_Logan_This_Is_Why_I_Love_You.wav",
    "title": "16 Logan This Is Why I Love You",
    "quote": "Logan: \"This is why I love you, Angela...\"",
    "space_tag": "20260217_1lPKqbPREoeGb",
    "space_title": "Cult Signups",
    "timestamp": "02:53:00",
    "url": "/clips/angela/16_Logan_This_Is_Why_I_Love_You.wav",
    "duration": 5.7,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_17",
    "filename": "17_Recording_Second_Device.wav",
    "title": "17 Recording Second Device",
    "quote": "I'm recording on my second device right now... people be deleting shit.",
    "space_tag": "20260926_1OGwbnVyavLKB",
    "space_title": "Monkey Island",
    "timestamp": "02:33:55",
    "url": "/clips/angela/17_Recording_Second_Device.wav",
    "duration": 8.1,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_18",
    "filename": "18_Getting_Everybodys_Details.wav",
    "title": "18 Getting Everybodys Details",
    "quote": "I'll be getting everybody else's details.",
    "space_tag": "20260926_1OGwbnVyavLKB",
    "space_title": "Monkey Island",
    "timestamp": "02:41:48",
    "url": "/clips/angela/18_Getting_Everybodys_Details.wav",
    "duration": 5.5,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_19",
    "filename": "19_Android_Read_Screenshot_Everything.wav",
    "title": "19 Android Read Screenshot Everything",
    "quote": "Even if you've removed me from a group chat... I can read and screenshot everything.",
    "space_tag": "20260926_1OGwbnVyavLKB",
    "space_title": "Monkey Island",
    "timestamp": "02:41:57",
    "url": "/clips/angela/19_Android_Read_Screenshot_Everything.wav",
    "duration": 7.88,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_20",
    "filename": "20_Infiltrating_Documenting_Discovering.wav",
    "title": "20 Infiltrating Documenting Discovering",
    "quote": "I've been infiltrating, documenting, and discovering.",
    "space_tag": "20260926_1OGwbnVyavLKB",
    "space_title": "Monkey Island",
    "timestamp": "02:43:41",
    "url": "/clips/angela/20_Infiltrating_Documenting_Discovering.wav",
    "duration": 3.34,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_21",
    "filename": "21_Collecting_NDAs_Act_Accordingly.wav",
    "title": "21 Collecting NDAs Act Accordingly",
    "quote": "I've been collecting NDAs... when you hear bad things about me, believe it. I act accordingly.",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "01:59:56",
    "url": "/clips/angela/21_Collecting_NDAs_Act_Accordingly.wav",
    "duration": 10,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_22",
    "filename": "22_Gather_All_Perspectives.wav",
    "title": "22 Gather All Perspectives",
    "quote": "I gather all evidence perspectives from different sides...",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "01:59:56",
    "url": "/clips/angela/22_Gather_All_Perspectives.wav",
    "duration": 5.68,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_23",
    "filename": "23_Called_Well_Check.wav",
    "title": "23 Called Well Check",
    "quote": "I was the one who called a well-check...",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "04:15",
    "url": "/clips/angela/23_Called_Well_Check.wav",
    "duration": 2.78,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_24",
    "filename": "24_CPS_Husband_Not_My_Responsibility.wav",
    "title": "24 CPS Husband Not My Responsibility",
    "quote": "Your husband and your kid with CPS... is not my fucking responsibility.",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "04:36",
    "url": "/clips/angela/24_CPS_Husband_Not_My_Responsibility.wav",
    "duration": 6,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_25",
    "filename": "25_Went_To_Police_Filed_Reports.wav",
    "title": "25 Went To Police Filed Reports",
    "quote": "I went to the police. I filed police reports...",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "05:07",
    "url": "/clips/angela/25_Went_To_Police_Filed_Reports.wav",
    "duration": 2.82,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_26",
    "filename": "26_The_Cop_Heard_It.wav",
    "title": "26 The Cop Heard It",
    "quote": "The cop heard it. I'm not worried about it.",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "05:07",
    "url": "/clips/angela/26_The_Cop_Heard_It.wav",
    "duration": 2,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_27",
    "filename": "27_Filed_IC3_Report.wav",
    "title": "27 Filed IC3 Report",
    "quote": "I went and filed an IC3 report...",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "05:37",
    "url": "/clips/angela/27_Filed_IC3_Report.wav",
    "duration": 3.1,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_28",
    "filename": "28_AI_Fucking_Porn_Claim.wav",
    "title": "28 AI Fucking Porn Claim",
    "quote": "She literally made a claim that me and Logan make AI fucking porn of her...",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "06:08",
    "url": "/clips/angela/28_AI_Fucking_Porn_Claim.wav",
    "duration": 7.4,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_29",
    "filename": "29_PowerPoint_Ready_For_Court.wav",
    "title": "29 PowerPoint Ready For Court",
    "quote": "I have a PowerPoint ready for court.",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "08:00",
    "url": "/clips/angela/29_PowerPoint_Ready_For_Court.wav",
    "duration": 2.76,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_30",
    "filename": "30_Going_To_Bankrupt_I_Mean_It.wav",
    "title": "30 Going To Bankrupt I Mean It",
    "quote": "I'm going to bankrupt you. I mean it.",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "08:00",
    "url": "/clips/angela/30_Going_To_Bankrupt_I_Mean_It.wav",
    "duration": 4.02,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_31",
    "filename": "31_Predator_Problem.wav",
    "title": "31 Predator Problem",
    "quote": "Because, no, we have a predator problem on this app...",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "02:08:43 / 04:05",
    "url": "/clips/angela/31_Predator_Problem.wav",
    "duration": 2.4,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_32",
    "filename": "32_Called_You_A_Predator.wav",
    "title": "32 Called You A Predator",
    "quote": "I didn't call you a fucking pedophile. I called you a predator because that is what you are...",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "02:08:43 / 04:07",
    "url": "/clips/angela/32_Called_You_A_Predator.wav",
    "duration": 6.09,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_33",
    "filename": "33_Impressionable_Girls_Trauma.wav",
    "title": "33 Impressionable Girls Trauma",
    "quote": "You seek out impressionable girls with trauma issues, and then you triangulate them against each other.",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "04:18",
    "url": "/clips/angela/33_Impressionable_Girls_Trauma.wav",
    "duration": 5,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_34",
    "filename": "34_Text_Messages_Will_Prove_It.wav",
    "title": "34 Text Messages Will Prove It",
    "quote": "And these text messages are going to prove that.",
    "space_tag": "20260918_1MJgNbdaAPlGL",
    "space_title": "LOGAN BLACK UNMASKED - WEAPONIZING WOMEN ON UFO X",
    "timestamp": "04:22",
    "url": "/clips/angela/34_Text_Messages_Will_Prove_It.wav",
    "duration": 2.48,
    "speaker": "Angela Maggard"
  },
  {
    "id": "angela_clip_35",
    "filename": "35_Look_At_Spaces_Read_Text.wav",
    "title": "35 Look At Spaces Read Text",
    "quote": "Go look at the spaces. Go read the text...",
    "space_tag": "20260930_1lJQRWLvWVzxE",
    "space_title": "The Social Cost of Taking a Suicide Threat Seriously",
    "timestamp": "08:08",
    "url": "/clips/angela/35_Look_At_Spaces_Read_Text.wav",
    "duration": 6.58,
    "speaker": "Angela Maggard"
  }
];
