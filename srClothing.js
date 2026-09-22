// SR1 vanilla clothing OBJ catalog + mount logic.
//
// The Character Creator picks a single OBJ per slot (pants / shirt /
// jacket / hat / shoes / hair / glasses / facial-hair) and we layer
// the loaded mesh on top of the bare body OBJ.  Each OBJ is loaded
// once + cached by objAssets.loadAsset(), attached to the relevant
// bone (torsoG for shirts/jackets, headG for hats/hair/glasses/face
// hair, body.__legR.hip + legL.hip for pants, body.__legR.knee +
// legL.knee for shoes) at the OBJ's authored world position (the
// same pivot trick the body slicer uses — pivot = bone world).
//
// All catalog entries are filenames present in
// /app/backend/static/models/srmodels (verified with `ls` at build
// time).  If the user picks the placeholder id `none` the slot is
// hidden.

export const SR_CLOTHING = {
  pants: [
    { id: 'none',                  name: 'None'                 },
    { id: 'cbotm_casbagy_bh',      name: 'Casual Baggy'         },
    { id: 'cbotm_canvaspants_bh',  name: 'Canvas Pants'         },
    { id: 'cbotm_canvaspants_bl',  name: 'Canvas Pants (Low)'   },
    { id: 'cbotm_dresspants_nh',   name: 'Dress Pants'          },
    { id: 'cbotm_dresspants_nl',   name: 'Dress Pants (Low)'    },
    { id: 'cbotm_drsbagypant_nh',  name: 'Dressy Baggy'         },
    { id: 'cbotm_drsbagypant_ll',  name: 'Dressy Baggy (Low)'   },
    { id: 'cbotm_drsbagypant_rl',  name: 'Dressy Baggy (Roll)'  },
    { id: 'cbotm_pimppants_nh',    name: 'Pimp Pants'           },
    { id: 'cbotm_pimppants_bh',    name: 'Pimp Pants (Baggy)'   },
    { id: 'cbotm_pimppants_lh',    name: 'Pimp Pants (Light)'   },
    { id: 'cbotm_pimppants_rh',    name: 'Pimp Pants (Roll)'    },
    { id: 'cbotm_pimppants_nl',    name: 'Pimp Pants (Low)'     },
    { id: 'cbotm_pimppants_rl',    name: 'Pimp Pants (Low/R)'   },
    { id: 'cbotm_sweatpants_nh',   name: 'Sweatpants'           },
    { id: 'cbotm_sweatpants_nl',   name: 'Sweatpants (Low)'     },
    { id: 'cbotm_trackpants_nl',   name: 'Track Pants'          },
    { id: 'cbotm_trackpants_bl',   name: 'Track Pants (Baggy)'  },
    { id: 'cbotm_trackpants_ll',   name: 'Track Pants (Light)'  },
    { id: 'cbotm_trackpants_hcc',  name: 'Track Pants (HCC)'    },
    { id: 'cbotm_trackpants_hor',  name: 'Track Pants (HOR)'    },
    { id: 'cbotm_trackpants_lcr',  name: 'Track Pants (LCR)'    },
    { id: 'cbotm_racingpants_nl',  name: 'Racing Pants'         },
  ],
  shirt: [
    { id: 'none',                  name: 'None'                 },
    { id: 'cunds_tshirt_cl',       name: 'T-Shirt'              },
    { id: 'cunds_tanktop',         name: 'Tank Top'             },
    { id: 'cunds_tanktop_cl',      name: 'Tank Top (CL)'        },
    { id: 'cunds_tanktop_te',      name: 'Tank Top (TE)'        },
    { id: 'cunds_tanktop_th',      name: 'Tank Top (TH)'        },
    { id: 'cunds_thermal_cl',      name: 'Thermal'              },
    { id: 'cunds_thermal_te',      name: 'Thermal (TE)'         },
    { id: 'cunds_gamestop_cl',     name: 'Gamestop Tee'         },
    { id: 'cunds_mime_cl',         name: 'Mime Stripe'          },
    { id: 'covrs_polo_cl',         name: 'Polo'                 },
    { id: 'covrs_polo_se',         name: 'Polo (SE)'            },
    { id: 'covrs_polo_th',         name: 'Polo (TH)'            },
    { id: 'covrs_polo_tl',         name: 'Polo (TL)'            },
    { id: 'covrs_hensleya_tl',     name: 'Henley'               },
    { id: 'covrs_workshirtss_op',  name: 'Work Shirt SS (OP)'   },
    { id: 'covrs_workshirtss_set', name: 'Work Shirt SS (Set)'  },
    { id: 'covrs_workshirtss_sh',  name: 'Work Shirt SS (SH)'   },
    { id: 'covrs_workshirtls_cl',  name: 'Work Shirt LS (CL)'   },
    { id: 'covrs_workshirtls_se',  name: 'Work Shirt LS (SE)'   },
    { id: 'covrs_workshirtls_tbt', name: 'Work Shirt LS (TBT)'  },
    { id: 'covrs_basketbjers_sh',  name: 'Basketball Jersey'    },
    { id: 'covrs_basketbjers_te',  name: 'Basketball (TE)'      },
    { id: 'covrs_baseballjrb_se',  name: 'Baseball Jersey'      },
    { id: 'covrs_baseballjrb_op',  name: 'Baseball (OP)'        },
    { id: 'covrs_baseballjrb_tb',  name: 'Baseball (TB)'        },
    { id: 'covrs_footballjrs_tl',  name: 'Football Jersey'      },
    { id: 'covrs_pullovrrnek_cl',  name: 'Pullover Crew'        },
    { id: 'covrs_pullovrrnek_se',  name: 'Pullover (SE)'        },
    { id: 'covrs_pullovrrnek_te',  name: 'Pullover (TE)'        },
    { id: 'covrs_turtleneck_se',   name: 'Turtleneck'           },
    { id: 'covrs_turtleneck_th',   name: 'Turtleneck (TH)'      },
    { id: 'covrs_buttonvest_cl',   name: 'Button Vest'          },
    { id: 'covrs_buttonvest_op',   name: 'Button Vest (Open)'   },
    { id: 'covrs_butonupb_ls_op',  name: 'Button-Up Open'       },
    { id: 'covrs_casbuttonls_cl',  name: 'Casual Button-Up'     },
  ],
  jacket: [
    { id: 'none',                  name: 'None'                 },
    { id: 'ccoat_hoody_ncd',       name: 'Hoody (Down)'         },
    { id: 'ccoat_hoody_ncu',       name: 'Hoody (Up)'           },
    { id: 'ccoat_hoody_nou',       name: 'Hoody Open'           },
    { id: 'ccoat_letterman_nc',    name: 'Letterman'            },
    { id: 'ccoat_denim_nc',        name: 'Denim Jacket'         },
    { id: 'ccoat_denim_no',        name: 'Denim Jacket Open'    },
    { id: 'ccoat_track_no',        name: 'Track Jacket'         },
    { id: 'ccoat_sportcoat_nc',    name: 'Sport Coat'           },
    { id: 'ccoat_doubbreast_cl',   name: 'Double-Breasted'      },
    { id: 'ccoat_puffycoat_cl',    name: 'Puffer Coat'          },
    { id: 'ccoat_pimpcoat_op',     name: 'Pimp Coat'            },
  ],
  hat: [
    { id: 'none',                  name: 'None'                 },
    { id: 'chat_baseballcap_b',    name: 'Baseball Cap'         },
    { id: 'chat_bandana_b',        name: 'Bandana (Back)'       },
    { id: 'chat_bandana_f',        name: 'Bandana (Front)'      },
    { id: 'chat_durag',            name: 'Du-Rag'               },
    { id: 'chat_flatcap_b',        name: 'Flatcap'              },
    { id: 'chat_flatcap_fl',       name: 'Flatcap (L)'          },
    { id: 'chat_flatcap_fr',       name: 'Flatcap (R)'          },
    { id: 'chat_fishingcap',       name: 'Fishing Cap'          },
    { id: 'chat_drivingcap_fl',    name: 'Driving Cap'          },
    { id: 'chat_fedora_n',         name: 'Fedora'               },
    { id: 'chat_fedora_l',         name: 'Fedora (L)'           },
    { id: 'chat_fedora_r',         name: 'Fedora (R)'           },
    { id: 'chat_snapbrim_bl',      name: 'Snapbrim'             },
    { id: 'chat_snapbrim_fl',      name: 'Snapbrim (FL)'        },
    { id: 'chat_santa_b',          name: 'Santa Hat'            },
    { id: 'pimphat',               name: 'Pimp Hat'             },
  ],
  shoes: [
    { id: 'none',                  name: 'None'                 },
    { id: 'cshoe_addidas',         name: 'Sneakers'             },
    { id: 'cshoe_basketball',      name: 'Basketball'           },
    { id: 'cshoe_canvas',          name: 'Canvas'               },
    { id: 'cshoe_timberland',      name: 'Boots'                },
    { id: 'cshoe_hikingboots',     name: 'Hiking Boots'         },
    { id: 'cshoe_cowboyboots',     name: 'Cowboy Boots'         },
  ],
  socks: [
    { id: 'none',                  name: 'None'                 },
    { id: 'csock_low',             name: 'Low Socks'            },
    { id: 'csock_medium',          name: 'Crew Socks'           },
    { id: 'csock_high',            name: 'Knee Socks'           },
    { id: 'csock_medwool',         name: 'Wool Socks'           },
  ],
  boxers: [
    { id: 'none',                  name: 'None'                 },
    { id: 'boxers',                name: 'Boxers'               },
  ],
  hair: [
    { id: 'none',                  name: 'Bald'                 },
    { id: 'htop_bowlcut',          name: 'Bowl Cut'             },
    { id: 'htop_dreadlocks',       name: 'Dreadlocks'           },
    { id: 'htop_fuzz',             name: 'Buzz / Fuzz'          },
    { id: 'htop_flatclippered',    name: 'Flat Clippered'       },
    { id: 'htop_flatflatc',        name: 'Flat Flatc'           },
    { id: 'htop_flatmoa',          name: 'Mohawk Flat'          },
    { id: 'htop_flatmullet',       name: 'Mullet Flat'          },
    { id: 'htop_flatsam',          name: 'Sam Cut'              },
    { id: 'htop_flatwidows',       name: 'Widows Peak'          },
  ],
  glasses: [
    { id: 'none',                  name: 'None'                 },
    { id: 'bglas_sunglassesa',     name: 'Sunglasses'           },
    { id: 'bglas_largeframed',     name: 'Large Frame'          },
    { id: 'bglas_stalker',         name: 'Stalker Shades'       },
  ],
  facialHair: [
    { id: 'none',                  name: 'Clean'                },
    { id: 'hbear_5oclock',         name: '5 O\u2019clock'       },
    { id: 'hbear_smchinpuff',      name: 'Chin Puff'            },
    { id: 'hbear_thin',            name: 'Thin Goatee'          },
    { id: 'hbear_santabeard',      name: 'Santa Beard'          },
    { id: 'hbear_genericplane',    name: 'Generic Beard'        },
    { id: 'hmust_a',               name: 'Mustache A'           },
    { id: 'hmust_e',               name: 'Mustache E'           },
    { id: 'hmust_f',               name: 'Mustache F'           },
    { id: 'hmust_g',               name: 'Mustache G'           },
    { id: 'hmust_genericplane',    name: 'Generic Mustache'     },
  ],
};

// Each slot's bone target + colour role + the (unrotated, pre-Y-flip)
// pivot that should be subtracted so the OBJ's authored Y/X positions
// land back where they belong once attached to the bone.
//
// `bone` is a string the consumer in characterModel3d.js resolves to a
// THREE.Group, `pivot` matches the bone world position, `colourRole`
// drives which build palette colour is applied (`torso` for shirts,
// `legs` for pants, `wrap` for hats/bandanas, `shoes` for shoes,
// `hair` for hair/facialhair, `frame` for glasses).
export const SLOT_META = {
  // NOTE: render order matters when meshes overlap. boxers sit under
  // pants/shorts, socks sit under shoes — declared FIRST so the
  // subsequent overlays paint on top.
  boxers:     { bone: 'torso', pivot: [0,      1.07, 0],   colourRole: 'boxers' },
  socks:      { bone: 'torso', pivot: [0,      1.07, 0],   colourRole: 'socks'  },
  pants:      { bone: 'torso', pivot: [0,      1.07, 0],   colourRole: 'legs'  },
  shirt:      { bone: 'torso', pivot: [0,      1.07, 0],   colourRole: 'torso' },
  jacket:     { bone: 'torso', pivot: [0,      1.07, 0],   colourRole: 'torso' },
  hat:        { bone: 'head',  pivot: [0,      1.81, 0],   colourRole: 'wrap'  },
  shoes:      { bone: 'torso', pivot: [0,      1.07, 0],   colourRole: 'shoes' },
  hair:       { bone: 'head',  pivot: [0,      1.81, 0],   colourRole: 'hair'  },
  glasses:    { bone: 'head',  pivot: [0,      1.81, 0],   colourRole: 'frame' },
  facialHair: { bone: 'head',  pivot: [0,      1.81, 0],   colourRole: 'hair'  },
};
